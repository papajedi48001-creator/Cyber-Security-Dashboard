import type { PrismaClient } from "@prisma/client";
import type { ConnectorName, ConnectorRecord, ConnectorStore } from "../settings/connectors";

export class PrismaConnectorStore implements ConnectorStore {
  constructor(private readonly db: PrismaClient) {}

  async get(name: ConnectorName): Promise<ConnectorRecord | null> {
    const row = await this.db.connectorSetting.findUnique({ where: { name } });
    return row ? { ...row, name: row.name as ConnectorName } : null;
  }

  async put(record: ConnectorRecord) {
    await this.db.connectorSetting.upsert({ where: { name: record.name }, update: record, create: record });
  }
}
