import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { JsonStore } from "./store.js";
import type { AlertDeliveryStatus } from "./signalEvents.js";
import type { DiscordWebhookPayload } from "./discordEmbeds.js";

export interface EncryptedWebhook {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface StoredDiscordDestination {
  destinationId: string;
  label: string;
  displayName: string | null;
  avatarUrl: string | null;
  encryptedWebhook: EncryptedWebhook;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastTestAt: string | null;
  lastSuccessfulDeliveryAt: string | null;
  latestResult: AlertDeliveryStatus | null;
}

interface DiscordDestinationFile {
  version: 1;
  destinations: StoredDiscordDestination[];
}

export interface PublicDiscordDestination {
  destinationId: string;
  label: string;
  displayName: string | null;
  avatarUrl: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastTestAt: string | null;
  lastSuccessfulDeliveryAt: string | null;
  latestResult: AlertDeliveryStatus | null;
  maskedEnding: string;
  legacy: boolean;
  editable: boolean;
}

export interface DiscordDeliveryTarget {
  destinationId: string;
  label: string;
  webhook: string;
  displayName: string | null;
  avatarUrl: string | null;
  legacy: boolean;
}

export interface DiscordWebhookTransport {
  send(
    webhook: string,
    payload: DiscordWebhookPayload,
  ): Promise<{ providerReference: string | null }>;
}

const destinationFile = "discord_destinations.json";
const legacyDestinationId = "legacy-server-configured";

export function parseCredentialEncryptionKey(value: string | undefined) {
  const supplied = value?.trim() ?? "";
  if (!supplied) {
    throw new Error("Credential encryption key is not configured.");
  }

  let material: Buffer;
  if (/^[a-f0-9]{64}$/i.test(supplied)) {
    material = Buffer.from(supplied, "hex");
  } else {
    const base64 = supplied.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = /^[A-Za-z0-9+/_=-]+$/.test(supplied)
      ? Buffer.from(base64, "base64")
      : Buffer.alloc(0);
    material =
      decoded.length >= 32 ? decoded : Buffer.from(supplied, "utf8");
  }

  if (material.length < 32) {
    throw new Error(
      "Credential encryption key must contain at least 32 bytes.",
    );
  }
  return createHash("sha256").update(material).digest();
}

export function loadCredentialEncryptionKey(
  environment: NodeJS.ProcessEnv = process.env,
  required = environment.NODE_ENV === "production",
) {
  const filePath =
    environment.RISKY_INVESTOR_CREDENTIAL_ENCRYPTION_KEY_FILE?.trim();
  let supplied =
    environment.RISKY_INVESTOR_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (filePath) {
    try {
      supplied = readFileSync(filePath, "utf8").trim();
    } catch {
      throw new Error("Unable to read the credential encryption key file.");
    }
  }
  if (!supplied) {
    if (required) {
      throw new Error(
        "Credential encryption key is required in production.",
      );
    }
    return null;
  }
  return parseCredentialEncryptionKey(supplied);
}

export function validateDiscordWebhook(value: string) {
  const supplied = value.trim();
  try {
    const url = new URL(supplied);
    const valid =
      url.protocol === "https:" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      ["discord.com", "discordapp.com"].includes(
        url.hostname.toLowerCase(),
      ) &&
      /^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname);
    if (!valid) throw new Error();
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error(
      "Enter a valid Discord HTTPS webhook URL from discord.com or discordapp.com.",
    );
  }
}

export class CredentialCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error("Credential encryption key is invalid.");
    }
  }

  encrypt(value: string, context: string): EncryptedWebhook {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return {
      version: 1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64url"),
      authTag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };
  }

  decrypt(value: EncryptedWebhook, context: string) {
    try {
      if (
        value.version !== 1 ||
        value.algorithm !== "aes-256-gcm"
      ) {
        throw new Error();
      }
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(value.iv, "base64url"),
      );
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(Buffer.from(value.authTag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(value.ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error("Stored Discord credential could not be decrypted.");
    }
  }
}

export class FetchDiscordWebhookTransport
  implements DiscordWebhookTransport
{
  async send(webhook: string, payload: DiscordWebhookPayload) {
    const url = new URL(validateDiscordWebhook(webhook));
    url.searchParams.set("wait", "true");
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Discord delivery failed (${response.status}).`);
    }
    const body = (await response.json().catch(() => ({}))) as {
      id?: unknown;
    };
    return {
      providerReference:
        typeof body.id === "string" ? body.id.slice(0, 100) : null,
    };
  }
}

function cleanLabel(value: unknown) {
  const label = typeof value === "string" ? value.trim() : "";
  if (!label) throw new Error("Destination label is required.");
  if (label.length > 80) {
    throw new Error("Destination label must be 80 characters or fewer.");
  }
  return label;
}

function cleanDisplayName(value: unknown) {
  const result = typeof value === "string" ? value.trim() : "";
  if (result.length > 80) {
    throw new Error("Display name must be 80 characters or fewer.");
  }
  return result || null;
}

function cleanAvatarUrl(value: unknown) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) return null;
  try {
    const url = new URL(result);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      result.length > 500
    ) {
      throw new Error();
    }
    return url.toString();
  } catch {
    throw new Error("Avatar URL must be a valid HTTPS URL.");
  }
}

function maskWebhook(value: string) {
  return value.slice(-4).padStart(4, "*");
}

export class DiscordDestinationManager {
  private mutationQueue = Promise.resolve();

  constructor(
    private readonly store: JsonStore,
    private readonly cipher: CredentialCipher | null,
    private readonly legacyWebhook: () => string | null,
    readonly transport: DiscordWebhookTransport =
      new FetchDiscordWebhookTransport(),
  ) {}

  validateLegacyConfiguration() {
    const webhook = this.legacyWebhook()?.trim();
    if (webhook) validateDiscordWebhook(webhook);
  }

  private requireCipher() {
    if (!this.cipher) {
      throw new Error("Credential encryption is not configured.");
    }
    return this.cipher;
  }

  private async readFile(): Promise<DiscordDestinationFile> {
    return (
      (await this.store.readOptional<DiscordDestinationFile>(
        destinationFile,
      )) ?? { version: 1, destinations: [] }
    );
  }

  private mutate<T>(
    operation: (file: DiscordDestinationFile) => Promise<T> | T,
  ) {
    const pending = this.mutationQueue.then(async () => {
      const file = await this.readFile();
      const result = await operation(file);
      await this.store.write(destinationFile, file);
      return result;
    });
    this.mutationQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private decrypt(destination: StoredDiscordDestination) {
    return validateDiscordWebhook(
      this.requireCipher().decrypt(
        destination.encryptedWebhook,
        `discord-destination:${destination.destinationId}`,
      ),
    );
  }

  private publicManaged(destination: StoredDiscordDestination) {
    const webhook = this.decrypt(destination);
    return {
      destinationId: destination.destinationId,
      label: destination.label,
      displayName: destination.displayName ?? null,
      avatarUrl: destination.avatarUrl ?? null,
      enabled: destination.enabled,
      createdAt: destination.createdAt,
      updatedAt: destination.updatedAt,
      lastTestAt: destination.lastTestAt,
      lastSuccessfulDeliveryAt:
        destination.lastSuccessfulDeliveryAt,
      latestResult: destination.latestResult,
      maskedEnding: maskWebhook(webhook),
      legacy: false,
      editable: true,
    } satisfies PublicDiscordDestination;
  }

  async publicDestinations() {
    const file = await this.readFile();
    return file.destinations.map((destination) =>
      this.publicManaged(destination),
    );
  }

  publicLegacyDestination(
    enabled: boolean,
    status: {
      lastTestAt?: string | null;
      lastSuccessfulDeliveryAt?: string | null;
      latestResult?: AlertDeliveryStatus | null;
    } = {},
  ): PublicDiscordDestination | null {
    const supplied = this.legacyWebhook()?.trim();
    if (!supplied) return null;
    const webhook = validateDiscordWebhook(supplied);
    return {
      destinationId: legacyDestinationId,
      label: "Legacy server-configured destination",
      displayName: null,
      avatarUrl: null,
      enabled,
      createdAt: "",
      updatedAt: "",
      lastTestAt: status.lastTestAt ?? null,
      lastSuccessfulDeliveryAt:
        status.lastSuccessfulDeliveryAt ?? null,
      latestResult: status.latestResult ?? null,
      maskedEnding: maskWebhook(webhook),
      legacy: true,
      editable: false,
    };
  }

  async create(input: {
    label: unknown;
    webhook: unknown;
    enabled?: unknown;
    displayName?: unknown;
    avatarUrl?: unknown;
  }) {
    const label = cleanLabel(input.label);
    const webhook = validateDiscordWebhook(
      typeof input.webhook === "string" ? input.webhook : "",
    );
    const destinationId = randomUUID();
    const now = new Date().toISOString();
    const destination: StoredDiscordDestination = {
      destinationId,
      label,
      displayName: cleanDisplayName(input.displayName),
      avatarUrl: cleanAvatarUrl(input.avatarUrl),
      encryptedWebhook: this.requireCipher().encrypt(
        webhook,
        `discord-destination:${destinationId}`,
      ),
      enabled: input.enabled === true,
      createdAt: now,
      updatedAt: now,
      lastTestAt: null,
      lastSuccessfulDeliveryAt: null,
      latestResult: null,
    };
    await this.mutate((file) => {
      file.version = 1;
      file.destinations.push(destination);
    });
    return this.publicManaged(destination);
  }

  async update(
    destinationId: string,
    input: {
      label?: unknown;
      enabled?: unknown;
      displayName?: unknown;
      avatarUrl?: unknown;
    },
  ) {
    return this.mutate((file) => {
      const destination = file.destinations.find(
        (item) => item.destinationId === destinationId,
      );
      if (!destination) throw new Error("Discord destination not found.");
      if (input.label !== undefined) {
        destination.label = cleanLabel(input.label);
      }
      if (input.enabled !== undefined) {
        destination.enabled = input.enabled === true;
      }
      if (input.displayName !== undefined) {
        destination.displayName = cleanDisplayName(input.displayName);
      }
      if (input.avatarUrl !== undefined) {
        destination.avatarUrl = cleanAvatarUrl(input.avatarUrl);
      }
      destination.updatedAt = new Date().toISOString();
      return this.publicManaged(destination);
    });
  }

  async replaceWebhook(destinationId: string, webhookValue: unknown) {
    const webhook = validateDiscordWebhook(
      typeof webhookValue === "string" ? webhookValue : "",
    );
    return this.mutate((file) => {
      const destination = file.destinations.find(
        (item) => item.destinationId === destinationId,
      );
      if (!destination) throw new Error("Discord destination not found.");
      destination.encryptedWebhook = this.requireCipher().encrypt(
        webhook,
        `discord-destination:${destinationId}`,
      );
      destination.updatedAt = new Date().toISOString();
      destination.latestResult = null;
      return this.publicManaged(destination);
    });
  }

  async delete(destinationId: string) {
    return this.mutate((file) => {
      const index = file.destinations.findIndex(
        (item) => item.destinationId === destinationId,
      );
      if (index < 0) throw new Error("Discord destination not found.");
      file.destinations.splice(index, 1);
      return { deleted: true };
    });
  }

  async target(destinationId: string): Promise<DiscordDeliveryTarget> {
    if (destinationId === legacyDestinationId) {
      const supplied = this.legacyWebhook()?.trim();
      if (!supplied) throw new Error("Discord destination not found.");
      return {
        destinationId,
        label: "Legacy server-configured destination",
        webhook: validateDiscordWebhook(supplied),
        displayName: null,
        avatarUrl: null,
        legacy: true,
      };
    }
    const file = await this.readFile();
    const destination = file.destinations.find(
      (item) => item.destinationId === destinationId,
    );
    if (!destination) throw new Error("Discord destination not found.");
    return {
      destinationId,
      label: destination.label,
      webhook: this.decrypt(destination),
      displayName: destination.displayName ?? null,
      avatarUrl: destination.avatarUrl ?? null,
      legacy: false,
    };
  }

  async deliveryTargets(allowLegacyAlongsideManaged: boolean) {
    const file = await this.readFile();
    const managed = file.destinations
      .filter((destination) => destination.enabled)
      .map((destination) => ({
        destinationId: destination.destinationId,
        label: destination.label,
        webhook: this.decrypt(destination),
        displayName: destination.displayName ?? null,
        avatarUrl: destination.avatarUrl ?? null,
        legacy: false,
      }));
    const supplied = this.legacyWebhook()?.trim();
    const includeLegacy =
      Boolean(supplied) &&
      (managed.length === 0 || allowLegacyAlongsideManaged);
    return [
      ...managed,
      ...(includeLegacy
        ? [
            {
              destinationId: legacyDestinationId,
              label: "Legacy server-configured destination",
              webhook: validateDiscordWebhook(supplied!),
              displayName: null,
              avatarUrl: null,
              legacy: true,
            },
          ]
        : []),
    ];
  }

  async recordResult(
    destinationId: string,
    status: AlertDeliveryStatus,
    options: { tested?: boolean; deliveredAt?: string | null } = {},
  ) {
    if (destinationId === legacyDestinationId) return;
    await this.mutate((file) => {
      const destination = file.destinations.find(
        (item) => item.destinationId === destinationId,
      );
      if (!destination) return;
      const now = new Date().toISOString();
      destination.latestResult = status;
      destination.updatedAt = now;
      if (options.tested) destination.lastTestAt = now;
      if (status === "sent") {
        destination.lastSuccessfulDeliveryAt =
          options.deliveredAt ?? now;
      }
    });
  }
}
