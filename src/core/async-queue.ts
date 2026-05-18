/**
 * 非同期イテレータ向けのシンプルなイベントキュー。
 * Pi Agent 購読など、push / yield パターンの手書き `resolve` を置き換える。
 */
export type AsyncEventQueue<T> = {
  /** キューにイベントを追加し、待機中のコンシューマを起こす。 */
  readonly push: (item: T) => void;
  /** これ以上 push されないことを示し、残りを drain したらイテレータを終了する。 */
  readonly close: () => void;
  readonly [Symbol.asyncIterator]: () => AsyncIterator<T>;
};

/**
 * 非同期イベントキューを生成する。
 */
export const createAsyncEventQueue = <T>(): AsyncEventQueue<T> => {
  const events: T[] = [];
  let closed = false;
  let resolveWait: (() => void) | null = null;

  const wake = (): void => {
    resolveWait?.();
    resolveWait = null;
  };

  const iterator = async function* (): AsyncGenerator<T> {
    while (!closed || events.length > 0) {
      if (events.length === 0) {
        if (closed) {
          break;
        }
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
        });
      }
      while (events.length > 0) {
        const item = events.shift();
        if (item !== undefined) {
          yield item;
        }
      }
    }
  };

  return {
    push: (item: T) => {
      events.push(item);
      wake();
    },
    close: () => {
      closed = true;
      wake();
    },
    [Symbol.asyncIterator]: () => iterator(),
  };
};
