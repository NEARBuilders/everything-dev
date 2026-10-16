import type { Messages } from "@lingui/core";
import { compileMessageOrThrow } from "@lingui/message-utils/compileMessage";

export const LOGIN_LOCALES = ["en", "es", "fr", "zh"] as const;

export type LoginLocale = (typeof LOGIN_LOCALES)[number];

export const DEFAULT_LOGIN_LOCALE: LoginLocale = "en";
export const LOGIN_LOCALE_COOKIE = "app_locale";

export const LOGIN_LOCALE_LABELS: Record<LoginLocale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  zh: "中文",
};

export const englishLoginMessages = {
  "auth.login.title": "Sign in to continue",
  "auth.login.subtitle": "Welcome back. Pick how you want to sign in.",
  "auth.login.subtitle.stake": "Sign in to stake with a community.",
  "auth.login.language": "Language",
  "auth.login.passkey.savedLabel": "Saved passkey",
  "auth.login.passkey.savedPlaceholder": "Choose a saved passkey",
  "auth.login.passkey.pending": "Waiting for passkey…",
  "auth.login.passkey.action": "Sign in with passkey",
  "auth.login.passkey.missingDesktop":
    "No passkey on this device? Use your phone or a NEAR wallet.",
  "auth.login.passkey.missingMobile": "No passkey on this device? Use a NEAR wallet.",
  "auth.login.near.continueAs": "Continue as {account}",
  "auth.login.near.useAnother": "Use another wallet",
  "auth.login.near.action": "Continue with NEAR",
  "auth.login.phone.action": "Sign in with your phone",
  "auth.login.phone.title": "Sign in with your phone",
  "auth.login.phone.subtitle": "Scan with a phone that's signed in.",
  "auth.login.create.title": "Create your account",
  "auth.login.create.subtitle.wallet":
    "One passkey on this device. We set up a NEAR wallet for you — no seed phrase.",
  "auth.login.create.subtitle.default": "One passkey on this device. No password to remember.",
  "auth.login.create.action": "Create account with passkey",
  "auth.login.create.unsupported":
    "This device can't create a supported passkey. Use a NEAR wallet instead.",
  "auth.login.create.existing": "Already have an account?",
  "auth.login.create.new": "New here?",
  "auth.login.create.link": "Create an account",
  "auth.login.signIn": "Sign in",
  "auth.login.suspended": "This account has been suspended.",
  "auth.login.separator": "or",
  "auth.login.success.create": "Welcome",
  "auth.login.success.near": "Signed in with NEAR",
  "auth.login.success.passkey": "Signed in with passkey",
  "auth.login.error.used": "Sign-in already used",
  "auth.login.error.signature": "Invalid signature",
  "auth.login.error.walletUnavailable": "NEAR wallet not available",
  "auth.login.error.configuration": "Sign-in configuration error",
  "auth.login.error.expired": "Session expired, please try again",
  "auth.login.error.generic": "Failed to sign in",
  "auth.login.error.passkey": "Passkey sign-in failed",
  "auth.login.error.disconnect": "Failed to disconnect wallet",
  "auth.login.error.nearConnect": "Failed to connect your NEAR wallet",
  "auth.login.pair.startFailed": "Could not start device pairing",
  "auth.login.pair.completeFailed": "Failed to complete sign-in",
  "auth.login.pair.success": "Signed in",
  "auth.login.pair.expired": "This code expired. Start again to get a new one.",
  "auth.login.pair.denied": "Sign-in was denied on your phone.",
  "auth.login.pair.imageAlt": "Scan with your phone to sign in",
  "auth.login.pair.instructions": "Or enter this code on your phone",
  "auth.login.pair.signingIn": "Signing in…",
  "auth.login.pair.waiting": "Waiting for your phone…",
  "auth.login.pair.cancel": "Other ways to sign in",
  "auth.device.verify.title": "Approve a sign-in",
  "auth.device.verify.descriptionWithCode": "Check this code matches the one on your other screen.",
  "auth.device.verify.descriptionNoCode": "Enter the code shown on your other screen.",
  "auth.device.verify.codeLabel": "Device code",
  "auth.device.verify.continue": "Continue",
  "auth.device.verify.claimFailed": "This code is invalid or has expired. Ask for a new one.",
  "auth.device.verify.connection": "Check your connection and try again.",
  "auth.device.verify.invalidCode": "That code doesn't look right. Check it and try again.",
  "auth.device.verify.checking": "Checking the code…",
  "auth.device.signIn": "Sign in to continue",
  "auth.device.approve.signInTitle": "Sign in to approve",
  "auth.device.approve.signInDescription":
    "Sign in on this device first, then approve the request.",
  "auth.device.approved.title": "Return to your terminal",
  "auth.device.approved.description": "The CLI received the credential. You can close this window.",
  "auth.device.approve.delegateTitle": "Approve publish key",
  "auth.device.approve.title": "Approve sign-in",
  "auth.device.approve.delegateDescription":
    "Adds a publish-only key to your NEAR account so the CLI can publish without gas.",
  "auth.device.approve.description": "Your other device will be signed in to this account.",
  "auth.device.approve.checkMatch": "Check it matches your other screen",
  "auth.device.approve.noCode": "No code provided. Start again from the other device.",
  "auth.device.approve.publicKey": "Public key",
  "auth.device.approve.publishKeyTitle": "Publish key",
  "auth.device.approve.publishKeyBody":
    "Only allowed to call __fastdata_kv on the registry, with a 1 NEAR gas allowance. The private key stays on your computer.",
  "auth.device.approve.accountMismatch":
    "You're signed in as {signedIn}, not {expected}. The key will be added to {signedIn}.",
  "auth.device.custody.label": "Custody wallet",
  "auth.device.custody.body":
    "Creates a new NEAR account whose keys live in OutLayer's TEE enclave. It signs your config publishes and can pay for agent compute. It never touches your own NEAR account — fund it separately when deploys need gas.",
  "auth.device.custody.description":
    "Approving also registers a custody wallet on {network} under your account. You can set its spending policy any time at the OutLayer dashboard.",
  "auth.device.custody.dashboard": "Set policy & fund the wallet",
  "auth.device.approve.failed":
    "Could not approve this code. It may have expired or been claimed elsewhere.",
  "auth.device.custody.failed":
    "Custody wallet provisioning failed. Nothing was approved — try again.",
  "auth.device.delegate.failed":
    "The wallet did not add the delegate key. Nothing was approved — try again.",
  "auth.device.delegate.toastFailed": "Failed to add delegate key",
  "auth.device.approved.cli": "Approved — return to your terminal",
  "auth.device.approved.device": "Approved — your other device is signing in",
  "auth.device.deny.success": "Sign-in request denied",
  "auth.device.deny.failed": "Could not deny this request. It may have already been handled.",
  "auth.device.approve.key": "Approve key",
  "auth.device.approve.approve": "Approve",
  "auth.device.approve.deny": "Deny",
} as const;

export type LoginMessageId = keyof typeof englishLoginMessages;
export type LoginMessageValues = Record<string, string | number>;
export type LoginTranslator = (id: LoginMessageId, values?: LoginMessageValues) => string;

const spanishLoginMessages = {
  "auth.login.title": "Inicia sesión para continuar",
  "auth.login.subtitle": "Te damos la bienvenida. Elige cómo quieres iniciar sesión.",
  "auth.login.subtitle.stake": "Inicia sesión para delegar con una comunidad.",
  "auth.login.language": "Idioma",
  "auth.login.passkey.savedLabel": "Clave de acceso guardada",
  "auth.login.passkey.savedPlaceholder": "Elige una clave de acceso guardada",
  "auth.login.passkey.pending": "Esperando la clave de acceso…",
  "auth.login.passkey.action": "Iniciar sesión con una clave de acceso",
  "auth.login.passkey.missingDesktop":
    "¿No hay una clave de acceso en este dispositivo? Usa tu teléfono o una billetera NEAR.",
  "auth.login.passkey.missingMobile":
    "¿No hay una clave de acceso en este dispositivo? Usa una billetera NEAR.",
  "auth.login.near.continueAs": "Continuar como {account}",
  "auth.login.near.useAnother": "Usar otra billetera",
  "auth.login.near.action": "Continuar con NEAR",
  "auth.login.phone.action": "Iniciar sesión con tu teléfono",
  "auth.login.phone.title": "Iniciar sesión con tu teléfono",
  "auth.login.phone.subtitle": "Escanea con un teléfono que tenga una sesión abierta.",
  "auth.login.create.title": "Crea tu cuenta",
  "auth.login.create.subtitle.wallet":
    "Una clave de acceso en este dispositivo. Configuraremos una billetera NEAR para ti, sin frase semilla.",
  "auth.login.create.subtitle.default":
    "Una clave de acceso en este dispositivo. No hay contraseña que recordar.",
  "auth.login.create.action": "Crear una cuenta con una clave de acceso",
  "auth.login.create.unsupported":
    "Este dispositivo no puede crear una clave de acceso compatible. Usa una billetera NEAR.",
  "auth.login.create.existing": "¿Ya tienes una cuenta?",
  "auth.login.create.new": "¿Eres nuevo aquí?",
  "auth.login.create.link": "Crear una cuenta",
  "auth.login.signIn": "Iniciar sesión",
  "auth.login.suspended": "Esta cuenta ha sido suspendida.",
  "auth.login.separator": "o",
  "auth.login.success.create": "Te damos la bienvenida",
  "auth.login.success.near": "Sesión iniciada con NEAR",
  "auth.login.success.passkey": "Sesión iniciada con una clave de acceso",
  "auth.login.error.used": "Este inicio de sesión ya se utilizó",
  "auth.login.error.signature": "Firma no válida",
  "auth.login.error.walletUnavailable": "La billetera NEAR no está disponible",
  "auth.login.error.configuration": "Error de configuración del inicio de sesión",
  "auth.login.error.expired": "La sesión ha caducado. Inténtalo de nuevo",
  "auth.login.error.generic": "No se pudo iniciar sesión",
  "auth.login.error.passkey": "No se pudo iniciar sesión con la clave de acceso",
  "auth.login.error.disconnect": "No se pudo desconectar la billetera",
  "auth.login.error.nearConnect": "No se pudo conectar tu billetera NEAR",
  "auth.login.pair.startFailed": "No se pudo iniciar la vinculación del dispositivo",
  "auth.login.pair.completeFailed": "No se pudo completar el inicio de sesión",
  "auth.login.pair.success": "Sesión iniciada",
  "auth.login.pair.expired": "Este código ha caducado. Empieza de nuevo para obtener otro.",
  "auth.login.pair.denied": "El inicio de sesión fue rechazado en tu teléfono.",
  "auth.login.pair.imageAlt": "Escanea con tu teléfono para iniciar sesión",
  "auth.login.pair.instructions": "O introduce este código en tu teléfono",
  "auth.login.pair.signingIn": "Iniciando sesión…",
  "auth.login.pair.waiting": "Esperando a tu teléfono…",
  "auth.login.pair.cancel": "Otras formas de iniciar sesión",
  "auth.device.verify.title": "Aprobar un inicio de sesión",
  "auth.device.verify.descriptionWithCode":
    "Comprueba que este código coincide con el de tu otra pantalla.",
  "auth.device.verify.descriptionNoCode": "Introduce el código que se muestra en tu otra pantalla.",
  "auth.device.verify.codeLabel": "Código del dispositivo",
  "auth.device.verify.continue": "Continuar",
  "auth.device.verify.claimFailed": "Este código no es válido o ha caducado. Solicita uno nuevo.",
  "auth.device.verify.connection": "Comprueba tu conexión e inténtalo de nuevo.",
  "auth.device.verify.invalidCode": "Ese código no parece correcto. Revísalo e inténtalo de nuevo.",
  "auth.device.verify.checking": "Comprobando el código…",
  "auth.device.signIn": "Inicia sesión para continuar",
  "auth.device.approve.signInTitle": "Inicia sesión para aprobar",
  "auth.device.approve.signInDescription":
    "Primero inicia sesión en este dispositivo y luego aprueba la solicitud.",
  "auth.device.approved.title": "Vuelve a tu terminal",
  "auth.device.approved.description":
    "El terminal recibió la credencial. Puedes cerrar esta ventana.",
  "auth.device.approve.delegateTitle": "Aprobar clave de publicación",
  "auth.device.approve.title": "Aprobar inicio de sesión",
  "auth.device.approve.delegateDescription":
    "Añade una clave de solo publicación a tu cuenta NEAR para que el terminal pueda publicar sin gas.",
  "auth.device.approve.description": "Tu otro dispositivo iniciará sesión en esta cuenta.",
  "auth.device.approve.checkMatch": "Comprueba que coincide con tu otra pantalla",
  "auth.device.approve.noCode":
    "No se proporcionó ningún código. Empieza de nuevo desde el otro dispositivo.",
  "auth.device.approve.publicKey": "Clave pública",
  "auth.device.approve.publishKeyTitle": "Clave de publicación",
  "auth.device.approve.publishKeyBody":
    "Solo puede llamar a __fastdata_kv en el registro, con una asignación de gas de 1 NEAR. La clave privada permanece en tu equipo.",
  "auth.device.approve.accountMismatch":
    "Has iniciado sesión como {signedIn}, no como {expected}. La clave se añadirá a {signedIn}.",
  "auth.device.custody.label": "Billetera de custodia",
  "auth.device.custody.body":
    "Crea una nueva cuenta NEAR cuyas claves viven en el enclave TEE de OutLayer. Firma tus publicaciones de configuración y puede pagar por computación de agentes. Nunca toca tu propia cuenta NEAR: finánciala por separado cuando los despliegues necesiten gas.",
  "auth.device.custody.description":
    "Al aprobar también se registra una billetera de custodia en {network} bajo tu cuenta. Puedes definir su política de gasto en cualquier momento en el panel de OutLayer.",
  "auth.device.custody.dashboard": "Definir política y financiar la billetera",
  "auth.device.approve.failed":
    "No se pudo aprobar este código. Puede haber caducado o haber sido usado en otro lugar.",
  "auth.device.custody.failed":
    "Falló el aprovisionamiento de la billetera de custodia. No se aprobó nada: inténtalo de nuevo.",
  "auth.device.delegate.failed":
    "La billetera no añadió la clave de delegado. No se aprobó nada: inténtalo de nuevo.",
  "auth.device.delegate.toastFailed": "No se pudo añadir la clave de delegado",
  "auth.device.approved.cli": "Aprobado: vuelve a tu terminal",
  "auth.device.approved.device": "Aprobado: tu otro dispositivo está iniciando sesión",
  "auth.device.deny.success": "Solicitud de inicio de sesión rechazada",
  "auth.device.deny.failed": "No se pudo rechazar esta solicitud. Puede que ya se haya gestionado.",
  "auth.device.approve.key": "Aprobar clave",
  "auth.device.approve.approve": "Aprobar",
  "auth.device.approve.deny": "Rechazar",
} satisfies Record<LoginMessageId, string>;

const frenchLoginMessages = {
  "auth.login.title": "Se connecter pour continuer",
  "auth.login.subtitle": "Ravi de vous revoir. Choisissez comment vous connecter.",
  "auth.login.subtitle.stake": "Connectez-vous pour déléguer auprès d’une communauté.",
  "auth.login.language": "Langue",
  "auth.login.passkey.savedLabel": "Clé d’accès enregistrée",
  "auth.login.passkey.savedPlaceholder": "Choisissez une clé d’accès enregistrée",
  "auth.login.passkey.pending": "En attente de la clé d’accès…",
  "auth.login.passkey.action": "Se connecter avec une clé d’accès",
  "auth.login.passkey.missingDesktop":
    "Aucune clé d’accès sur cet appareil ? Utilisez votre téléphone ou un portefeuille NEAR.",
  "auth.login.passkey.missingMobile":
    "Aucune clé d’accès sur cet appareil ? Utilisez un portefeuille NEAR.",
  "auth.login.near.continueAs": "Continuer en tant que {account}",
  "auth.login.near.useAnother": "Utiliser un autre portefeuille",
  "auth.login.near.action": "Continuer avec NEAR",
  "auth.login.phone.action": "Se connecter avec votre téléphone",
  "auth.login.phone.title": "Se connecter avec votre téléphone",
  "auth.login.phone.subtitle": "Scannez avec un téléphone déjà connecté.",
  "auth.login.create.title": "Créer votre compte",
  "auth.login.create.subtitle.wallet":
    "Une clé d’accès sur cet appareil. Nous créons un portefeuille NEAR pour vous, sans phrase de récupération.",
  "auth.login.create.subtitle.default":
    "Une clé d’accès sur cet appareil. Aucun mot de passe à retenir.",
  "auth.login.create.action": "Créer un compte avec une clé d’accès",
  "auth.login.create.unsupported":
    "Cet appareil ne peut pas créer de clé d’accès compatible. Utilisez plutôt un portefeuille NEAR.",
  "auth.login.create.existing": "Vous avez déjà un compte ?",
  "auth.login.create.new": "Nouveau ici ?",
  "auth.login.create.link": "Créer un compte",
  "auth.login.signIn": "Se connecter",
  "auth.login.suspended": "Ce compte a été suspendu.",
  "auth.login.separator": "ou",
  "auth.login.success.create": "Bienvenue",
  "auth.login.success.near": "Connecté avec NEAR",
  "auth.login.success.passkey": "Connecté avec une clé d’accès",
  "auth.login.error.used": "Cette connexion a déjà été utilisée",
  "auth.login.error.signature": "Signature non valide",
  "auth.login.error.walletUnavailable": "Le portefeuille NEAR n’est pas disponible",
  "auth.login.error.configuration": "Erreur de configuration de la connexion",
  "auth.login.error.expired": "La session a expiré. Veuillez réessayer",
  "auth.login.error.generic": "Échec de la connexion",
  "auth.login.error.passkey": "Échec de la connexion avec la clé d’accès",
  "auth.login.error.disconnect": "Impossible de déconnecter le portefeuille",
  "auth.login.error.nearConnect": "Impossible de connecter votre portefeuille NEAR",
  "auth.login.pair.startFailed": "Impossible de démarrer l’association de l’appareil",
  "auth.login.pair.completeFailed": "Impossible de terminer la connexion",
  "auth.login.pair.success": "Connecté",
  "auth.login.pair.expired": "Ce code a expiré. Recommencez pour en obtenir un nouveau.",
  "auth.login.pair.denied": "La connexion a été refusée sur votre téléphone.",
  "auth.login.pair.imageAlt": "Scannez avec votre téléphone pour vous connecter",
  "auth.login.pair.instructions": "Ou saisissez ce code sur votre téléphone",
  "auth.login.pair.signingIn": "Connexion en cours…",
  "auth.login.pair.waiting": "En attente de votre téléphone…",
  "auth.login.pair.cancel": "Autres méthodes de connexion",
  "auth.device.verify.title": "Approuver une connexion",
  "auth.device.verify.descriptionWithCode":
    "Vérifiez que ce code correspond à celui de votre autre écran.",
  "auth.device.verify.descriptionNoCode": "Saisissez le code affiché sur votre autre écran.",
  "auth.device.verify.codeLabel": "Code de l’appareil",
  "auth.device.verify.continue": "Continuer",
  "auth.device.verify.claimFailed": "Ce code est invalide ou a expiré. Demandez-en un nouveau.",
  "auth.device.verify.connection": "Vérifiez votre connexion et réessayez.",
  "auth.device.verify.invalidCode": "Ce code ne semble pas correct. Vérifiez-le et réessayez.",
  "auth.device.verify.checking": "Vérification du code…",
  "auth.device.signIn": "Se connecter pour continuer",
  "auth.device.approve.signInTitle": "Connectez-vous pour approuver",
  "auth.device.approve.signInDescription":
    "Connectez-vous d’abord sur cet appareil, puis approuvez la demande.",
  "auth.device.approved.title": "Retournez à votre terminal",
  "auth.device.approved.description":
    "Le terminal a reçu l’identifiant. Vous pouvez fermer cette fenêtre.",
  "auth.device.approve.delegateTitle": "Approuver la clé de publication",
  "auth.device.approve.title": "Approuver la connexion",
  "auth.device.approve.delegateDescription":
    "Ajoute une clé de publication seule à votre compte NEAR pour que le terminal puisse publier sans gas.",
  "auth.device.approve.description": "Votre autre appareil va se connecter à ce compte.",
  "auth.device.approve.checkMatch": "Vérifiez qu’il correspond à votre autre écran",
  "auth.device.approve.noCode": "Aucun code fourni. Recommencez depuis l’autre appareil.",
  "auth.device.approve.publicKey": "Clé publique",
  "auth.device.approve.publishKeyTitle": "Clé de publication",
  "auth.device.approve.publishKeyBody":
    "Autorisée uniquement à appeler __fastdata_kv sur le registre, avec une allocation de gas de 1 NEAR. La clé privée reste sur votre ordinateur.",
  "auth.device.approve.accountMismatch":
    "Vous êtes connecté en tant que {signedIn}, pas {expected}. La clé sera ajoutée à {signedIn}.",
  "auth.device.custody.label": "Portefeuille de dépôt",
  "auth.device.custody.body":
    "Crée un nouveau compte NEAR dont les clés vivent dans l’enclave TEE d’OutLayer. Il signe vos publications de configuration et peut payer le calcul des agents. Il ne touche jamais votre propre compte NEAR : financez-le séparément quand les déploiements ont besoin de gas.",
  "auth.device.custody.description":
    "L’approbation enregistre également un portefeuille de dépôt sur {network} sous votre compte. Vous pouvez définir sa politique de dépense à tout moment dans le tableau de bord OutLayer.",
  "auth.device.custody.dashboard": "Définir la politique et financer le portefeuille",
  "auth.device.approve.failed":
    "Impossible d’approuver ce code. Il a peut-être expiré ou été réclamé ailleurs.",
  "auth.device.custody.failed":
    "Échec du provisionnement du portefeuille de dépôt. Rien n’a été approuvé — réessayez.",
  "auth.device.delegate.failed":
    "Le portefeuille n’a pas ajouté la clé de délégué. Rien n’a été approuvé — réessayez.",
  "auth.device.delegate.toastFailed": "Impossible d’ajouter la clé de délégué",
  "auth.device.approved.cli": "Approuvé — retournez à votre terminal",
  "auth.device.approved.device": "Approuvé — votre autre appareil se connecte",
  "auth.device.deny.success": "Demande de connexion refusée",
  "auth.device.deny.failed":
    "Impossible de refuser cette demande. Elle a peut-être déjà été traitée.",
  "auth.device.approve.key": "Approuver la clé",
  "auth.device.approve.approve": "Approuver",
  "auth.device.approve.deny": "Refuser",
} satisfies Record<LoginMessageId, string>;

const chineseLoginMessages = {
  "auth.login.title": "登录以继续",
  "auth.login.subtitle": "欢迎回来。请选择登录方式。",
  "auth.login.subtitle.stake": "登录后即可为社区质押。",
  "auth.login.language": "语言",
  "auth.login.passkey.savedLabel": "已保存的通行密钥",
  "auth.login.passkey.savedPlaceholder": "选择已保存的通行密钥",
  "auth.login.passkey.pending": "正在等待通行密钥…",
  "auth.login.passkey.action": "使用通行密钥登录",
  "auth.login.passkey.missingDesktop": "此设备上没有通行密钥？请使用手机或 NEAR 钱包。",
  "auth.login.passkey.missingMobile": "此设备上没有通行密钥？请使用 NEAR 钱包。",
  "auth.login.near.continueAs": "以 {account} 身份继续",
  "auth.login.near.useAnother": "使用其他钱包",
  "auth.login.near.action": "使用 NEAR 继续",
  "auth.login.phone.action": "使用手机登录",
  "auth.login.phone.title": "使用手机登录",
  "auth.login.phone.subtitle": "使用已登录的手机扫描二维码。",
  "auth.login.create.title": "创建账户",
  "auth.login.create.subtitle.wallet":
    "在此设备上创建一个通行密钥。我们会为你设置 NEAR 钱包，无需助记词。",
  "auth.login.create.subtitle.default": "在此设备上创建一个通行密钥，无需记住密码。",
  "auth.login.create.action": "使用通行密钥创建账户",
  "auth.login.create.unsupported": "此设备无法创建受支持的通行密钥，请改用 NEAR 钱包。",
  "auth.login.create.existing": "已有账户？",
  "auth.login.create.new": "第一次使用？",
  "auth.login.create.link": "创建账户",
  "auth.login.signIn": "登录",
  "auth.login.suspended": "此账户已被停用。",
  "auth.login.separator": "或",
  "auth.login.success.create": "欢迎",
  "auth.login.success.near": "已使用 NEAR 登录",
  "auth.login.success.passkey": "已使用通行密钥登录",
  "auth.login.error.used": "此登录请求已使用",
  "auth.login.error.signature": "签名无效",
  "auth.login.error.walletUnavailable": "NEAR 钱包不可用",
  "auth.login.error.configuration": "登录配置错误",
  "auth.login.error.expired": "会话已过期，请重试",
  "auth.login.error.generic": "登录失败",
  "auth.login.error.passkey": "使用通行密钥登录失败",
  "auth.login.error.disconnect": "无法断开钱包连接",
  "auth.login.error.nearConnect": "无法连接你的 NEAR 钱包",
  "auth.login.pair.startFailed": "无法开始设备配对",
  "auth.login.pair.completeFailed": "无法完成登录",
  "auth.login.pair.success": "已登录",
  "auth.login.pair.expired": "此代码已过期，请重新开始以获取新代码。",
  "auth.login.pair.denied": "你的手机拒绝了登录请求。",
  "auth.login.pair.imageAlt": "使用手机扫描以登录",
  "auth.login.pair.instructions": "或在手机上输入此代码",
  "auth.login.pair.signingIn": "正在登录…",
  "auth.login.pair.waiting": "正在等待你的手机…",
  "auth.login.pair.cancel": "其他登录方式",
  "auth.device.verify.title": "批准登录",
  "auth.device.verify.descriptionWithCode": "请核对此代码与另一屏幕上的代码一致。",
  "auth.device.verify.descriptionNoCode": "请输入另一屏幕上显示的代码。",
  "auth.device.verify.codeLabel": "设备代码",
  "auth.device.verify.continue": "继续",
  "auth.device.verify.claimFailed": "此代码无效或已过期。请申请新代码。",
  "auth.device.verify.connection": "请检查网络连接后重试。",
  "auth.device.verify.invalidCode": "该代码看起来不正确。请检查后重试。",
  "auth.device.verify.checking": "正在核对代码…",
  "auth.device.signIn": "登录以继续",
  "auth.device.approve.signInTitle": "登录以批准",
  "auth.device.approve.signInDescription": "请先在此设备上登录，然后再批准该请求。",
  "auth.device.approved.title": "回到你的终端",
  "auth.device.approved.description": "终端已收到凭据。你可以关闭此窗口。",
  "auth.device.approve.delegateTitle": "批准发布密钥",
  "auth.device.approve.title": "批准登录",
  "auth.device.approve.delegateDescription":
    "向你的 NEAR 账户添加一把仅可发布的密钥，让终端无需 gas 即可发布。",
  "auth.device.approve.description": "你的另一台设备将登录此账户。",
  "auth.device.approve.checkMatch": "请核对它与你的另一屏幕一致",
  "auth.device.approve.noCode": "未提供代码。请从另一台设备重新开始。",
  "auth.device.approve.publicKey": "公钥",
  "auth.device.approve.publishKeyTitle": "发布密钥",
  "auth.device.approve.publishKeyBody":
    "只允许调用注册表上的 __fastdata_kv，gas 限额为 1 NEAR。私钥保留在你的电脑上。",
  "auth.device.approve.accountMismatch":
    "你登录的是 {signedIn}，而不是 {expected}。密钥将添加到 {signedIn}。",
  "auth.device.custody.label": "托管钱包",
  "auth.device.custody.body":
    "创建一个新的 NEAR 账户，其密钥保存在 OutLayer 的 TEE enclave 中。它为你的配置发布签名，并可支付 agent 计算费用。它绝不会触碰你自己的 NEAR 账户——当部署需要 gas 时请单独为其充值。",
  "auth.device.custody.description":
    "批准后还会在你的账户下注册一个 {network} 上的托管钱包。你可以随时在 OutLayer 控制台设置其支出策略。",
  "auth.device.custody.dashboard": "设置策略并为钱包充值",
  "auth.device.approve.failed": "无法批准此代码。它可能已过期或在别处被使用。",
  "auth.device.custody.failed": "托管钱包配置失败。未批准任何内容——请重试。",
  "auth.device.delegate.failed": "钱包未能添加委托密钥。未批准任何内容——请重试。",
  "auth.device.delegate.toastFailed": "添加委托密钥失败",
  "auth.device.approved.cli": "已批准——回到你的终端",
  "auth.device.approved.device": "已批准——你的另一台设备正在登录",
  "auth.device.deny.success": "已拒绝登录请求",
  "auth.device.deny.failed": "无法拒绝此请求。它可能已被处理。",
  "auth.device.approve.key": "批准密钥",
  "auth.device.approve.approve": "批准",
  "auth.device.approve.deny": "拒绝",
} satisfies Record<LoginMessageId, string>;

const translatedLoginMessages: Record<LoginLocale, Partial<Record<LoginMessageId, string>>> = {
  en: {},
  es: spanishLoginMessages,
  fr: frenchLoginMessages,
  zh: chineseLoginMessages,
};

export function withEnglishLoginFallback(
  translated: Partial<Record<LoginMessageId, string>>,
): Messages {
  return { ...englishLoginMessages, ...translated };
}

export function getLoginMessages(locale: LoginLocale): Messages {
  return Object.fromEntries(
    Object.entries(withEnglishLoginFallback(translatedLoginMessages[locale])).map(
      ([id, message]) => [
        id,
        typeof message === "string" ? compileMessageOrThrow(message) : message,
      ],
    ),
  );
}
