const BOOT_SPLASH = '<div class="boot-splash">验证会话中...</div>';

export function createAuthGate({ root, router, authView, getMe }) {
  let authTeardown = null;
  let transition = 0;

  function disposeAuthView() {
    authTeardown?.();
    authTeardown = null;
  }

  function showAuth(initialMessage = "") {
    disposeAuthView();
    authTeardown = authView.mount(root, {
      initialMessage,
      onAuthenticated: enterAuthenticated,
      onRetry: start,
    });
  }

  function enterAuthenticated(_user) {
    transition += 1;
    disposeAuthView();
    router.start();
  }

  async function start() {
    const currentTransition = ++transition;
    disposeAuthView();
    root.innerHTML = BOOT_SPLASH;
    try {
      const user = await getMe();
      if (currentTransition !== transition) return;
      if (user) {
        enterAuthenticated(user);
      } else {
        showAuth();
      }
    } catch (_error) {
      if (currentTransition !== transition) return;
      showAuth("无法连接账号服务，请重试。");
    }
  }

  function signOut() {
    transition += 1;
    router.stop();
    showAuth();
  }

  return { start, signOut };
}
