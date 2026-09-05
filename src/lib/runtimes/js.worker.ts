import { createJsEngine } from './js-engine'
import { installWorkerHost } from './worker-host'

// This worker serves both languages; preload the compiler before timing tests.
installWorkerHost(createJsEngine('typescript'))
