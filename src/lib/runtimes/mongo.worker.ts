import { createMongoEngine } from './mongo-engine'
import { installWorkerHost } from './worker-host'

installWorkerHost(createMongoEngine())
