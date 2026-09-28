const accountButton = document.querySelector('#accountButton');
const accountAvatar = document.querySelector('#accountAvatar');
const accountLabel = document.querySelector('#accountLabel');
const authGate = document.querySelector('#authGate');
const authGateButton = document.querySelector('#authGateButton');
const authGateTitle = document.querySelector('#authGateTitle');
const authGateCopy = document.querySelector('#authGateCopy');
const authGateStatus = document.querySelector('#authGateStatus');

// Firebase config is intentionally injected separately so the public app can be
// connected to the correct Firebase project without putting project-specific
// credentials in the source code by accident.
const firebaseConfig = window.STORYBOARD_FIREBASE_CONFIG;
const publicReview = new URLSearchParams(location.hash.slice(1)).has('share') || new URLSearchParams(location.hash.slice(1)).has('review');
const reviewsEntry = document.documentElement.dataset.studioApp === 'reviews';

function setAuthGate(locked, title = '', copy = '', status = '') {
  document.body.classList.toggle('auth-locked', locked);
  if (authGate) authGate.hidden = !locked;
  if (title && authGateTitle) authGateTitle.textContent = title;
  if (copy && authGateCopy) authGateCopy.textContent = copy;
  if (authGateStatus) authGateStatus.textContent = status;
}

function showAuthMessage(message) {
  if (authGateStatus) authGateStatus.textContent = message;
  if (typeof window.showToast === 'function') window.showToast(message);
  else accountButton?.setAttribute('title', message);
}

function renderSignedOut() {
  window.STUDIO_SIGNED_IN = false;
  window.STUDIO_ROLE = null;
  window.STUDIO_USER = null;
  window.STUDIO_PERMISSIONS = {};
  authGateButton.textContent = 'Continuar con Google →';
  accountAvatar.textContent = 'G';
  accountAvatar.style.backgroundImage = '';
  accountLabel.textContent = 'Iniciar sesión';
  accountButton?.setAttribute('aria-label', 'Iniciar sesión con Google');
  accountButton?.classList.remove('is-authenticated');
  setAuthGate(!publicReview, 'Iniciá sesión para entrar.', 'Tu espacio de preproducción está protegido. Continuá con tu cuenta de Google para ver tus proyectos.');
  window.dispatchEvent(new Event('studio-auth-change'));
}

function renderSignedIn(user, access) {
  window.STUDIO_SIGNED_IN = true;
  window.STUDIO_ROLE = access.role;
  window.STUDIO_PERMISSIONS = access.permissions;
  window.STUDIO_USER = user;
  const name = user.displayName || user.email || 'Cuenta';
  accountLabel.textContent = name;
  accountButton?.setAttribute('aria-label', `Cerrar sesión de ${name}`);
  accountButton?.classList.add('is-authenticated');
  if (user.photoURL) {
    accountAvatar.textContent = '';
    accountAvatar.style.backgroundImage = `url("${user.photoURL.replaceAll('"', '')}")`;
  } else {
    accountAvatar.textContent = name.trim().charAt(0).toUpperCase() || 'G';
    accountAvatar.style.backgroundImage = '';
  }
  if (!publicReview && reviewsEntry && !access.permissions.reviewsView) {
    authGateButton.textContent = 'Cerrar sesión';
    setAuthGate(true, 'No tenés acceso a Reviews.', 'Pedile al administrador que habilite Reviews para tu cuenta.');
  } else if (!publicReview && !reviewsEntry && !access.permissions.storyboards) {
    authGateButton.textContent = 'Cerrar sesión';
    setAuthGate(true, 'No tenés acceso a Storyboards.', 'Pedile al administrador que habilite Storyboards para tu cuenta.');
  } else {
    setAuthGate(false);
  }
  window.dispatchEvent(new Event('studio-auth-change'));
  if (!publicReview && reviewsEntry && access.permissions.reviewsView) window.STUDIO_SHOW_REVIEWS?.();
}

function renderNoAccess(user) {
  window.STUDIO_SIGNED_IN = false;
  window.STUDIO_ROLE = null;
  window.STUDIO_PERMISSIONS = {};
  window.STUDIO_USER = user;
  authGateButton.textContent = 'Cerrar sesión';
  accountAvatar.textContent = (user.displayName || user.email || 'G').charAt(0).toUpperCase();
  accountLabel.textContent = user.email || 'Cuenta sin acceso';
  accountButton?.setAttribute('aria-label', 'Cerrar sesión');
  setAuthGate(!publicReview, 'Tu cuenta está pendiente.', 'El administrador de GB Studio debe habilitar tu cuenta y elegir qué secciones podés usar.');
  window.dispatchEvent(new Event('studio-auth-change'));
}

if (!firebaseConfig?.apiKey || !firebaseConfig?.authDomain || !firebaseConfig?.projectId) {
  renderSignedOut();
  setAuthGate(true, 'No se pudo conectar el acceso.', 'La configuración de Firebase no está disponible en esta versión publicada.', 'Revisá la conexión del proyecto e intentá nuevamente.');
  const missingConfigMessage = () => showAuthMessage('No se pudo cargar la configuración de Firebase. Recargá la página e intentá nuevamente.');
  accountButton?.addEventListener('click', missingConfigMessage);
  authGateButton?.addEventListener('click', missingConfigMessage);
} else {
  try {
    const [{ initializeApp }, { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut }, cloud] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js'),
      import('./reviews-cloud.js?v=3'),
    ]);
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    let stopRoleWatch = null;
    window.STUDIO_CLOUD = cloud;
    onAuthStateChanged(auth, user => {
      stopRoleWatch?.(); stopRoleWatch = null;
      if (!user || user.isAnonymous) { renderSignedOut(); return; }
      const google = user.emailVerified && user.providerData.some(item => item.providerId === 'google.com');
      if (!google) { renderNoAccess(user); return; }
      if (user.email?.toLowerCase() === 'info@granbertafilms.com') { renderSignedIn(user, { role: 'admin', permissions: { ...cloud.ALL_PERMISSIONS } }); return; }
      if (!publicReview) setAuthGate(true, 'Verificando acceso…', 'Estamos comprobando si tu cuenta está autorizada para entrar al estudio.');
      if (!publicReview) cloud.registerAccessRequest(user).catch(error => {
        console.error('Could not register access request', error);
        if (auth.currentUser?.uid === user.uid && !window.STUDIO_SIGNED_IN) showAuthMessage('No se pudo registrar tu solicitud. Pedile al administrador que agregue tu correo manualmente.');
      });
      stopRoleWatch = cloud.watchStaffRole(user, access => {
        if (auth.currentUser?.uid !== user.uid) return;
        access ? renderSignedIn(user, access) : renderNoAccess(user);
      }, error => {
        if (auth.currentUser?.uid !== user.uid) return;
        console.error('Could not verify studio access', error);
        renderNoAccess(user);
        if (!publicReview) setAuthGate(true, 'No se pudo verificar el acceso.', 'Revisá la conexión con Firebase e intentá nuevamente.');
      });
    });
    const signIn = async () => {
      try {
        await signInWithPopup(auth, provider);
      } catch (error) {
        console.error('Google sign-in failed', error);
        const code = error?.code || '';
        if (code.includes('operation-not-allowed')) showAuthMessage('Activá Google en Firebase → Authentication → Sign-in method.');
        else if (code.includes('unauthorized-domain')) showAuthMessage('Agregá gb-films.github.io en Firebase → Authentication → Authorized domains.');
        else if (code.includes('popup-blocked')) showAuthMessage('El navegador bloqueó la ventana de Google. Permití ventanas emergentes para este sitio.');
        else showAuthMessage('No se pudo iniciar sesión con Google. Revisá la configuración de Firebase.');
      }
    };
    accountButton?.addEventListener('click', async () => {
      if (auth.currentUser) await signOut(auth);
      else await signIn();
    });
    authGateButton?.addEventListener('click', async () => {
      if (auth.currentUser) await signOut(auth);
      else await signIn();
    });
  } catch (error) {
    console.error('Firebase auth could not be initialized', error);
    renderSignedOut();
    setAuthGate(true, 'No se pudo cargar el acceso.', 'Firebase no respondió correctamente. Recargá la página e intentá nuevamente.', 'Si el problema continúa, revisá la configuración del proveedor Google.');
    const initErrorMessage = () => showAuthMessage('No se pudo cargar el acceso con Google. Recargá la página e intentá nuevamente.');
    accountButton?.addEventListener('click', initErrorMessage);
    authGateButton?.addEventListener('click', initErrorMessage);
  }
}
