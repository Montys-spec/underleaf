import type { UnderleafApi } from '../shared/types'

declare global {
  interface Window {
    underleaf: UnderleafApi
  }
}
