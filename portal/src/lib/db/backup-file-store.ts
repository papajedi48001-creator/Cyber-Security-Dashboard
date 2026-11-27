import type { PrismaClient } from "@prisma/client";
import type { BackupFileRequest, BackupFileRequestStore, NewBackupFileRequest, RequestStatus } from "../backup-files/service";

type Row = Omit<BackupFileRequest, "sizeBytes"> & { sizeBytes: bigint };
const toRequest = ({ sizeBytes, ...row }: Row): BackupFileRequest => ({ ...row, sizeBytes: Number(sizeBytes) });

export class PrismaBackupFileRequestStore implements BackupFileRequestStore {
  constructor(private readonly db: PrismaClient) {}

  async create(request: NewBackupFileRequest) {
    return toRequest(await this.db.backupLifecycleRequest.create({ data: { ...request, sizeBytes: BigInt(request.sizeBytes) } }));
  }
  async findById(id: string) {
    const row = await this.db.backupLifecycleRequest.findUnique({ where: { id } });
    return row ? toRequest(row) : null;
  }
  async list(limit: number) {
    return (await this.db.backupLifecycleRequest.findMany({ orderBy: { proposedAt: "desc" }, take: limit })).map(toRequest);
  }
  async listByStatus(statuses: readonly RequestStatus[]) {
    return (await this.db.backupLifecycleRequest.findMany({ where: { status: { in: [...statuses] } }, orderBy: { proposedAt: "asc" } })).map(toRequest);
  }
  async transition(id: string, from: readonly RequestStatus[], { sizeBytes, id: _id, ...change }: Partial<BackupFileRequest> & { status: RequestStatus }) {
    const { count } = await this.db.backupLifecycleRequest.updateMany({
      where: { id, status: { in: [...from] } },
      data: { ...change, ...(sizeBytes === undefined ? {} : { sizeBytes: BigInt(sizeBytes) }) },
    });
    return count === 1;
  }
}
