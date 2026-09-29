const accountButton = document.querySelector('#accountButton');
const accountAvatar = document.querySelector('#accountAvatar');
const accountLabel = document.querySelector('#accountLabel');
const profileModal = document.querySelector('#profileModal');
const profileAvatar = document.querySelector('#profileAvatar');
const profileName = document.querySelector('#profileName');
const profileEmail = document.querySelector('#profileEmail');
const profileVistoRole = document.querySelector('#profileVistoRole');
const profilePdrRole = document.querySelector('#profilePdrRole');
const profileMiraRole = document.querySelector('#profileMiraRole');
const profileModules = document.querySelector('#profileModules');
const authGate = document.querySelector('#authGate');
const authGateButton = document.querySelector('#authGateButton');
const authGateTitle = document.querySelector('#authGateTitle');
const authGateCopy = document.querySelector('#authGateCopy');
const authGateStatus = document.querySelector('#authGateStatus');
let homeAppHandler = null;
for (const [id, app] of [['homeCompiLink', 'compi'], ['homePdrLink', 'pdr']]) {
  document.getElementById(id)?.addEventListener('click', () => {
    if (homeAppHandler) homeAppHandler(app);
    else showAuthMessage('Preparando el acceso. Volvé a tocar la aplicación en un momento.');
  });
}

// Firebase config is intentionally injected separately so the public app can be
// connected to the correct Firebase project without putting project-specific
// credentials in the source code by accident.
const firebaseConfig = window.STORYBOARD_FIREBASE_CONFIG;
const publicReview = new URLSearchParams(location.hash.slice(1)).has('share') || new URLSearchParams(location.hash.slice(1)).has('review');
const reviewsEntry = document.documentElement.dataset.studioApp === 'reviews';
const pdrEntry = document.documentElement.dataset.studioApp === 'pdr';
const homeEntry = document.documentElement.dataset.studioApp === 'home';

function updateHomeModules(permissions = null) {
  const visitor = permissions === null;
  for (const [id, statusId, enabled, url] of [
    ['homeStoryboardsLink', 'homeStoryboardsStatus', visitor || permissions.storyboards === true || permissions.storyboardsView === true, '?app=storyboards'],
    ['homeReviewsLink', 'homeReviewsStatus', visitor || permissions.reviewsView === true || permissions.reviewsClient === true, '?app=reviews'],
    ['homePdrLink', 'homePdrStatus', visitor || permissions.pdr === true || permissions.pdrView === true, '?app=pdr'],
  ]) {
    const link = document.getElementById(id);
    if (!link) continue;
    if (enabled) link.setAttribute('href', url);
    else link.removeAttribute('href');
    link.classList.toggle('is-unavailable', !enabled);
    link.setAttribute('aria-disabled', String(!enabled));
    const status = document.getElementById(statusId);
    if (status) status.textContent = visitor ? 'Iniciá sesión para entrar →' : enabled ? 'Entrar a la herramienta →' : 'Sin acceso asignado';
  }
  const compiStatus = document.getElementById('homeCompiStatus');
  if (compiStatus) compiStatus.textContent = visitor ? 'Iniciá sesión para descargar ↓' : window.STUDIO_SIGNED_IN ? 'Descargar para Windows ↓' : 'Acceso pendiente';
}

function setAuthGate(locked, title = '', copy = '', status = '') {
  document.body.classList.toggle('auth-locked', locked);
  if (authGate) authGate.hidden = !locked;
  if (title && authGateTitle) authGateTitle.textContent = title;
  if (copy && authGateCopy) authGateCopy.textContent = copy;
  if (authGateStatus) authGateStatus.textContent = status;
}

function setAuthPending() {
  if (homeEntry) return;
  document.body.classList.add('auth-locked');
  if (authGate) authGate.hidden = true;
}

function showAuthMessage(message) {
  if (authGateStatus) authGateStatus.textContent = message;
  if (typeof window.showToast === 'function') window.showToast(message);
  else {
    const toast = document.querySelector('#toast');
    if (toast) {
      toast.textContent = message;
      toast.classList.add('is-visible');
      setTimeout(() => toast.classList.remove('is-visible'), 3500);
    } else accountButton?.setAttribute('title', message);
  }
}

function closeProfile() {
  if (profileModal) profileModal.hidden = true;
  accountButton?.setAttribute('aria-expanded', 'false');
}

function openProfile() {
  if (!profileModal) return;
  profileModal.hidden = false;
  accountButton?.setAttribute('aria-expanded', 'true');
  document.querySelector('#profileCloseIcon')?.focus();
}

function updateProfile(user, access = null, pending = false) {
  if (!user) return;
  const name = user.displayName || user.email || 'Cuenta';
  if (profileName) profileName.textContent = name;
  if (profileEmail) profileEmail.textContent = user.email || '';
  const permissions = access?.permissions || {};
  if (profileVistoRole) profileVistoRole.textContent = pending ? 'Pendiente' : permissions.storyboards ? 'Acceso completo' : permissions.storyboardsView ? 'Solo lectura' : 'Sin acceso';
  if (profilePdrRole) profilePdrRole.textContent = pending ? 'Pendiente' : permissions.pdr ? 'Acceso completo' : permissions.pdrView ? 'Solo lectura' : 'Sin acceso';
  if (profileMiraRole) profileMiraRole.textContent = access?.role === 'review_guest' ? 'Invitado de review' : pending ? 'Pendiente' : permissions.reviewsClient ? 'Cliente' : permissions.reviewsView && permissions.reviewsCreate && permissions.reviewsEdit && permissions.reviewsShare ? 'Acceso completo' : permissions.reviewsView && permissions.reviewsEdit ? 'Edición' : permissions.reviewsView ? 'Solo lectura' : 'Sin acceso';
  if (profileAvatar) {
    profileAvatar.textContent = user.photoURL ? '' : name.trim().charAt(0).toUpperCase() || 'G';
    profileAvatar.style.backgroundImage = user.photoURL ? `url("${user.photoURL.replaceAll('"', '')}")` : '';
  }
  if (profileModules) {
    profileModules.replaceChildren();
    const enabled = [];
    if (access?.permissions?.storyboards || access?.permissions?.storyboardsView) enabled.push('Visto');
    if (access?.permissions?.pdr || access?.permissions?.pdrView) enabled.push('PDR');
    if (access?.role === 'review_guest' || access?.permissions?.reviewsView || access?.permissions?.reviewsClient) enabled.push('Mira');
    if (enabled.length) {
      const list = document.createElement('div'); list.className = 'profile-module-list';
      for (const moduleName of enabled) {
        const chip = document.createElement('span'); chip.className = 'profile-module-chip'; chip.textContent = moduleName; list.append(chip);
      }
      profileModules.append(list);
    } else {
      const empty = document.createElement('p'); empty.className = 'profile-modules-empty';
      empty.textContent = pending ? 'Todavía no hay módulos habilitados.' : 'No hay módulos habilitados.';
      profileModules.append(empty);
    }
  }
}

function renderSignedOut() {
  closeProfile();
  updateHomeModules();
  window.STUDIO_SIGNED_IN = false;
  window.STUDIO_ROLE = null;
  window.STUDIO_MIRA_ROLE = null;
  window.STUDIO_USER = null;
  window.STUDIO_PERMISSIONS = {};
  window.STUDIO_REVIEW_TOKENS = [];
  authGateButton.textContent = 'Continuar con Google →';
  accountAvatar.textContent = 'G';
  accountAvatar.style.backgroundImage = '';
  accountLabel.textContent = 'Iniciar sesión';
  accountButton?.setAttribute('aria-label', 'Iniciar sesión con Google');
  accountButton?.setAttribute('aria-expanded', 'false');
  accountButton?.classList.remove('is-authenticated');
  setAuthGate(!publicReview && !homeEntry, 'Iniciá sesión para entrar.', 'Continuá con tu cuenta de Google para usar esta herramienta.');
  window.dispatchEvent(new Event('studio-auth-change'));
}

function renderSignedIn(user, access) {
  closeProfile();
  window.STUDIO_SIGNED_IN = true;
  window.STUDIO_ROLE = access.role;
  window.STUDIO_MIRA_ROLE = access.roles?.reviews || (access.permissions.reviewsClient ? 'client' : null);
  window.STUDIO_PERMISSIONS = access.permissions;
  window.STUDIO_REVIEW_TOKENS = access.reviewTokens || [];
  window.STUDIO_USER = user;
  const name = user.displayName || user.email || 'Cuenta';
  accountLabel.textContent = name;
  accountButton?.setAttribute('aria-label', `Ver perfil de ${name}`);
  accountButton?.setAttribute('aria-controls', 'profileModal');
  accountButton?.classList.add('is-authenticated');
  if (user.photoURL) {
    accountAvatar.textContent = '';
    accountAvatar.style.backgroundImage = `url("${user.photoURL.replaceAll('"', '')}")`;
  } else {
    accountAvatar.textContent = name.trim().charAt(0).toUpperCase() || 'G';
    accountAvatar.style.backgroundImage = '';
  }
  updateProfile(user, access);
  updateHomeModules(access.permissions);
  const canEnterPdr = access.permissions.pdr || access.permissions.pdrView;
  const canEnterReviews = access.permissions.reviewsView || access.permissions.reviewsClient;
  if (!publicReview && pdrEntry && !canEnterPdr) {
    authGateButton.textContent = 'Cerrar sesión';
    setAuthGate(true, 'No tenés acceso a PDR.', 'Pedile al administrador que habilite PDR para tu cuenta.');
  } else if (!publicReview && reviewsEntry && !canEnterReviews) {
    authGateButton.textContent = 'Cerrar sesión';
    setAuthGate(true, 'No tenés acceso a Mira.', 'Pedile al administrador que habilite Mira para tu cuenta.');
  } else if (!publicReview && !reviewsEntry && !homeEntry && !access.permissions.storyboards && !access.permissions.storyboardsView) {
    authGateButton.textContent = 'Cerrar sesión';
    setAuthGate(true, 'No tenés acceso a Visto.', 'Pedile al administrador que habilite Visto para tu cuenta.');
  } else {
    setAuthGate(false);
  }
  window.dispatchEvent(new Event('studio-auth-change'));
  if (!publicReview && reviewsEntry && canEnterReviews) window.STUDIO_SHOW_REVIEWS?.();
}

function renderNoAccess(user) {
  closeProfile();
  window.STUDIO_SIGNED_IN = false;
  window.STUDIO_ROLE = null;
  window.STUDIO_MIRA_ROLE = null;
  window.STUDIO_PERMISSIONS = {};
  window.STUDIO_REVIEW_TOKENS = [];
  window.STUDIO_USER = user;
  updateHomeModules({});
  authGateButton.textContent = 'Cerrar sesión';
  accountAvatar.textContent = (user.displayName || user.email || 'G').charAt(0).toUpperCase();
  accountLabel.textContent = user.email || 'Cuenta sin acceso';
  accountButton?.setAttribute('aria-label', `Ver perfil de ${user.displayName || user.email || 'la cuenta'}`);
  accountButton?.setAttribute('aria-controls', 'profileModal');
  updateProfile(user, null, true);
  setAuthGate(!publicReview && !homeEntry, 'Tu cuenta está pendiente.', 'El administrador de GB Studio debe habilitar tu cuenta y elegir qué secciones podés usar.');
  window.dispatchEvent(new Event('studio-auth-change'));
}

if (!firebaseConfig?.apiKey || !firebaseConfig?.authDomain || !firebaseConfig?.projectId) {
  renderSignedOut();
  if (!homeEntry) setAuthGate(true, 'No se pudo conectar el acceso.', 'La configuración de Firebase no está disponible en esta versión publicada.', 'Revisá la conexión del proyecto e intentá nuevamente.');
  const missingConfigMessage = () => showAuthMessage('No se pudo cargar la configuración de Firebase. Recargá la página e intentá nuevamente.');
  homeAppHandler = missingConfigMessage;
  accountButton?.addEventListener('click', missingConfigMessage);
  authGateButton?.addEventListener('click', missingConfigMessage);
  document.querySelector('#reviewsGuestGoogle')?.addEventListener('click', missingConfigMessage);
} else {
  try {
    const [{ initializeApp }, { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut }, cloud] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js'),
      import('./reviews-cloud.js?v=7'),
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
      // A shared review is a link-scoped client visit, not a request for studio access.
      if (publicReview) { renderSignedIn(user, { role: 'review_guest', permissions: {} }); return; }
      if (user.email?.toLowerCase() === 'info@granbertafilms.com') { renderSignedIn(user, { role: 'admin', permissions: { ...cloud.ALL_PERMISSIONS } }); return; }
      if (!publicReview) setAuthPending();
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
        if (!publicReview && !homeEntry) setAuthGate(true, 'No se pudo verificar el acceso.', 'Revisá la conexión con Firebase e intentá nuevamente.');
      });
    });
    const signIn = async () => {
      try {
        return (await signInWithPopup(auth, provider)).user;
      } catch (error) {
        console.error('Google sign-in failed', error);
        const code = error?.code || '';
        if (code.includes('operation-not-allowed')) showAuthMessage('Activá Google en Firebase → Authentication → Sign-in method.');
        else if (code.includes('unauthorized-domain')) showAuthMessage('Agregá gb-films.github.io en Firebase → Authentication → Authorized domains.');
        else if (code.includes('popup-blocked')) showAuthMessage('El navegador bloqueó la ventana de Google. Permití ventanas emergentes para este sitio.');
        else showAuthMessage('No se pudo iniciar sesión con Google. Revisá la configuración de Firebase.');
        return null;
      }
    };
    const authorizedHomeUser = async () => {
      const user = auth.currentUser && !auth.currentUser.isAnonymous ? auth.currentUser : await signIn();
      if (!user) return false;
      try {
        if (await cloud.staffRole(user)) return true;
        showAuthMessage('Tu cuenta está pendiente de autorización para usar las aplicaciones.');
      } catch (error) {
        console.error('Could not verify application access', error);
        showAuthMessage('No se pudo verificar tu acceso. Intentá de nuevo.');
      }
      return false;
    };
    homeAppHandler = async appName => {
      if (!await authorizedHomeUser()) return;
      if (appName === 'pdr') { window.location.assign('?app=pdr'); return; }
      const link = document.createElement('a');
      link.href = 'downloads/Compi.zip';
      link.download = 'Compi v1.1.6.zip';
      document.body.append(link);
      link.click();
      link.remove();
    };
    accountButton?.addEventListener('click', async () => {
      if (auth.currentUser && !auth.currentUser.isAnonymous) openProfile();
      else await signIn();
    });
    document.querySelector('#reviewsGuestGoogle')?.addEventListener('click', signIn);
    document.querySelector('#profileCloseIcon')?.addEventListener('click', closeProfile);
    document.querySelector('#profileCloseButton')?.addEventListener('click', closeProfile);
    profileModal?.addEventListener('click', event => { if (event.target === profileModal) closeProfile(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && profileModal && !profileModal.hidden) closeProfile(); });
    document.querySelector('#profileSignOutButton')?.addEventListener('click', async () => {
      if (auth.currentUser) await signOut(auth);
      closeProfile();
    });
    authGateButton?.addEventListener('click', async () => {
      if (auth.currentUser) await signOut(auth);
      else await signIn();
    });
  } catch (error) {
    console.error('Firebase auth could not be initialized', error);
    renderSignedOut();
    if (!homeEntry) setAuthGate(true, 'No se pudo cargar el acceso.', 'Firebase no respondió correctamente. Recargá la página e intentá nuevamente.', 'Si el problema continúa, revisá la configuración del proveedor Google.');
    const initErrorMessage = () => showAuthMessage('No se pudo cargar el acceso con Google. Recargá la página e intentá nuevamente.');
    homeAppHandler = initErrorMessage;
    accountButton?.addEventListener('click', initErrorMessage);
    authGateButton?.addEventListener('click', initErrorMessage);
    document.querySelector('#reviewsGuestGoogle')?.addEventListener('click', initErrorMessage);
  }
}
