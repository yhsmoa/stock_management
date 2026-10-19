/* ================================================================
   속도 제한 큐 — 쿠팡 Open API (판매자당 초당 5회) 준수용
   - 동시 요청 수(concurrency)와 요청 간 최소 간격(intervalMs)을 함께 건다
   - AbortSignal 로 중단: 진행 중인 요청은 끝까지 기다리고 새 요청은 시작하지 않는다
   - 각 항목의 성공/실패를 PromiseSettledResult 로 돌려준다 (하나가 실패해도 계속)
   - 기준: purchaseService.fetchDetailsFromApi 의 인라인 큐와 같은 규칙
   ================================================================ */

export interface RateLimitOptions {
  /** 동시 진행 수 (쿠팡: 5) */
  concurrency: number
  /** 요청 시작 간 최소 간격 ms (쿠팡: 200 = 1000/5) */
  intervalMs: number
  signal?: AbortSignal
  /** 항목 하나가 끝날 때마다 (성공·실패 모두) */
  onProgress?: (done: number, total: number) => void
}

/** 쿠팡 Open API 기본값 — 초당 5회 */
export const COUPANG_RATE_LIMIT: Pick<RateLimitOptions, 'concurrency' | 'intervalMs'> = {
  concurrency: 5,
  intervalMs: 200,
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * items 를 순서대로 task 에 넘겨 속도 제한 안에서 실행한다.
 * 중단(signal)되면 아직 시작하지 않은 항목은 `{ status: 'rejected', reason: AbortError }` 로 채운다.
 */
export async function runRateLimited<T, R>(
  items: readonly T[],
  task: (item: T, index: number) => Promise<R>,
  options: RateLimitOptions,
): Promise<PromiseSettledResult<R>[]> {
  const { concurrency, intervalMs, signal, onProgress } = options
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  const inFlight = new Set<Promise<void>>()
  let done = 0
  let aborted = false

  const abortError = () => {
    const err = new Error('중단됨')
    err.name = 'AbortError'
    return err
  }

  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) { aborted = true }
    if (aborted) {
      results[i] = { status: 'rejected', reason: abortError() }
      continue
    }

    if (inFlight.size >= concurrency) {
      await Promise.race(inFlight)
    }
    await delay(intervalMs)
    if (signal?.aborted) {
      aborted = true
      results[i] = { status: 'rejected', reason: abortError() }
      continue
    }

    const index = i
    const run = (async () => {
      try {
        const value = await task(items[index], index)
        results[index] = { status: 'fulfilled', value }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      } finally {
        done++
        onProgress?.(done, items.length)
      }
    })()
    inFlight.add(run)
    run.finally(() => inFlight.delete(run))
  }

  await Promise.all(inFlight)
  return results
}

/** AbortError 인지 */
export function isAbortError(reason: unknown): boolean {
  return reason instanceof Error && reason.name === 'AbortError'
}
