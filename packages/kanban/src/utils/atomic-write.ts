export type { AtomicWriteOptions, FileLockOptions } from '@wrongstack/persistence';
export {
  atomicWrite,
  ensureDir,
  PersistenceFsError as FsError,
  withFileLock,
} from '@wrongstack/persistence';
