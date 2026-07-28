import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptDir = fileURLToPath(new URL('.', import.meta.url))
const mobileRoot = resolve(scriptDir, '../..')
const flowPath = resolve(mobileRoot, '.maestro/flows/auth-smoke.yaml')
const envExamplePath = resolve(mobileRoot, '.maestro/.env.example')
const appPath = resolve(mobileRoot, 'src/features/auth/screens/AuthScreen.tsx')
const screenShellPath = resolve(mobileRoot, 'src/components/dashboard/ScreenShell.tsx')

const requiredEnvKeys = [
  'APP_ID',
  'MAESTRO_DEV_SERVER_URL',
  'MAESTRO_DEV_CLIENT_SCHEME',
  'MAESTRO_DEVICE',
  'MAESTRO_MIN_VERSION',
  'E2E_API_HEALTH_URL',
  'EXPO_PUBLIC_E2E',
  'E2E_DISPLAY_NAME',
  'E2E_EMAIL',
  'E2E_PASSWORD',
  'MAESTRO_SKIP_API_PREFLIGHT',
  'MAESTRO_SKIP_METRO_PREFLIGHT',
  'MAESTRO_SKIP_E2E_ENV_PREFLIGHT',
  'MAESTRO_DRY_RUN',
]

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function readRequiredFile(filePath) {
  assert(existsSync(filePath), `Missing required file: ${filePath}`)
  return readFileSync(filePath, 'utf8')
}

function declaredEnvKeys(fileContents) {
  return new Set(
    fileContents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => line.split('=')[0].trim()),
  )
}

function functionDeclaration(sourceFile, name) {
  return sourceFile.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  )
}

function jsxAttribute(sourceFile, node, name) {
  return node.attributes.properties
    .filter(ts.isJsxAttribute)
    .find((attribute) => attribute.name.getText(sourceFile) === name)
}

function jsxBooleanAttributeIsEnabled(attribute) {
  if (!attribute) return false
  if (!attribute.initializer) return true
  if (!ts.isJsxExpression(attribute.initializer)) return false

  return attribute.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword
}

export function authScreenUsesKeyboardAwareShell(source) {
  const sourceFile = ts.createSourceFile(
    appPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const authScreen = functionDeclaration(sourceFile, 'AuthScreen')
  let usesKeyboardAwareShell = false

  function visit(node) {
    if (
      (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) &&
      (ts.isJsxElement(node)
        ? node.openingElement.tagName.getText(sourceFile)
        : node.tagName.getText(sourceFile)) === 'ScreenShell'
    ) {
      const openingElement = ts.isJsxElement(node) ? node.openingElement : node
      usesKeyboardAwareShell ||= jsxBooleanAttributeIsEnabled(
        jsxAttribute(sourceFile, openingElement, 'keyboardAware'),
      )
    }

    ts.forEachChild(node, visit)
  }

  if (authScreen?.body) visit(authScreen.body)
  return usesKeyboardAwareShell
}

export function runMaestroPolicyAudit() {
  const flow = readRequiredFile(flowPath)
  const app = readRequiredFile(appPath)
  const screenShell = readRequiredFile(screenShellPath)
  const envKeys = declaredEnvKeys(readRequiredFile(envExamplePath))
  const missingEnvKeys = requiredEnvKeys.filter((key) => !envKeys.has(key))

  assert(
    missingEnvKeys.length === 0,
    `.maestro/.env.example must document public Maestro runner inputs: missing ${missingEnvKeys.join(
      ', ',
    )}`,
  )
  assert(
    flow.includes('clearState: true') && flow.includes('clearKeychain: true'),
    'auth-smoke.yaml must clear app state and keychain at the start of the flow',
  )
  assert(
    flow.includes('link: ${DEV_CLIENT_URL}'),
    'auth-smoke.yaml must open the Expo dev-client bundle through DEV_CLIENT_URL',
  )
  assert(
    (flow.match(/link: \$\{DEV_CLIENT_URL\}/g) ?? []).length >= 2,
    'auth-smoke.yaml must reopen DEV_CLIENT_URL after stopApp to avoid landing on the simulator home screen',
  )
  assert(
    flow.includes('id: ${APPROVAL_SCREEN_ID}'),
    'auth-smoke.yaml must assert the approval gate after registration and restore',
  )
  assert(!flow.includes('hideKeyboard'), 'auth-smoke.yaml must not use flaky hideKeyboard')
  assert(
    flow.includes('centerElement: true') && flow.includes('visibilityPercentage: 100'),
    'auth-smoke.yaml must center important CTA targets before tapping',
  )
  assert(
    !/point:\s*\{/.test(flow) && !/point:\s*\n/.test(flow),
    'auth-smoke.yaml must not use coordinate taps',
  )
  assert(
    app.includes("process.env.EXPO_PUBLIC_E2E === '1'") &&
      app.includes('secureTextEntry={!isE2eMode}'),
    'password field must stay secure in production and become automatable only under EXPO_PUBLIC_E2E=1',
  )
  assert(
    authScreenUsesKeyboardAwareShell(app) &&
      screenShell.includes("keyboardDismissMode: keyboardAware ? 'on-drag' : undefined") &&
      screenShell.includes('keyboardAvoiding={keyboardAware}'),
    'auth form must use the keyboard-aware ScreenShell with on-drag dismissal for iOS Maestro stability',
  )
}

// `file://${process.argv[1]}` never matches import.meta.url on Windows, which
// silently turned this audit into a no-op that still exited 0.
if (import.meta.main) {
  runMaestroPolicyAudit()
  process.stdout.write('[maestro-policy-audit] ok\n')
}
