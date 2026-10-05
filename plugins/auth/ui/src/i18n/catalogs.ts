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
