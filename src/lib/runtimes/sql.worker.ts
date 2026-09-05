import { createSqlEngine } from './sql-engine'
import { installWorkerHost } from './worker-host'

installWorkerHost(createSqlEngine())
