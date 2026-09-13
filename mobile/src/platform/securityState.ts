/**
 * 권한(카메라/마이크 등) 상태 추상화: 요청·재요청 가능 여부 어댑터.
 */
export type PermissionStatus = {
  readonly granted: boolean;
  readonly canAskAgain: boolean;
};

export type PermissionSelectionAdapter<Result> = {
  readonly getPermission: () => Promise<PermissionStatus>;
  readonly requestPermission: () => Promise<PermissionStatus>;
  readonly select: () => Promise<Result>;
  readonly permissionDenied: () => Error;
};

export function createPermissionSelectionController<Result>(adapter: PermissionSelectionAdapter<Result>) {
  return {
    async select(): Promise<Result> {
      let permission = await adapter.getPermission();
      if (!permission.granted && permission.canAskAgain) permission = await adapter.requestPermission();
      if (!permission.granted) throw adapter.permissionDenied();
      return adapter.select();
    },
  };
}

export type ForegroundRefreshAdapter<Result> = {
  readonly refresh: () => Promise<Result>;
  readonly onSuccess: (result: Result) => void;
  readonly onFailure: (error: unknown) => void;
  readonly startAutoRefresh?: () => void;
  readonly stopAutoRefresh?: () => void;
};

export function createForegroundRefreshController<Result>(
  adapter: ForegroundRefreshAdapter<Result>,
  initiallyForeground = true,
) {
  let foreground = initiallyForeground;
  let disposed = false;
  let generation = 0;

  async function refresh(): Promise<boolean> {
    if (disposed || !foreground) return false;
    const started = generation;
    try {
      const result = await adapter.refresh();
      if (disposed || !foreground || started !== generation) return false;
      adapter.onSuccess(result);
      return true;
    } catch (error) {
      if (disposed || !foreground || started !== generation) return false;
      adapter.onFailure(error);
      return false;
    }
  }

  return {
    start() {
      if (!disposed && foreground) adapter.startAutoRefresh?.();
    },
    setAppState(state: string): Promise<boolean> {
      if (disposed) return Promise.resolve(false);
      if (state !== 'active') {
        foreground = false;
        generation += 1;
        adapter.stopAutoRefresh?.();
        return Promise.resolve(false);
      }
      foreground = true;
      adapter.startAutoRefresh?.();
      return refresh();
    },
    retry: refresh,
    dispose() {
      disposed = true;
      generation += 1;
      adapter.stopAutoRefresh?.();
    },
  };
}
