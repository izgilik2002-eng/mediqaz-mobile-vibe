const googleIosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME?.trim();

const plugins = [
  'expo-router',
  'expo-font',
  'expo-image',
  [
    'expo-splash-screen',
    {
      backgroundColor: '#208AEF',
      android: {
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    },
  ],
  'expo-secure-store',
  'expo-notifications',
  'expo-status-bar',
  'expo-apple-authentication',
  'expo-localization',
  [
    'expo-audio',
    {
      microphonePermission: 'Приложению нужен доступ к микрофону, чтобы записывать приём.',
      // Registers the native foreground recording service (Android) and
      // UIBackgroundModes (iOS) the recorder needs to keep running once the
      // phone locks or the doctor switches apps.
      enableBackgroundRecording: true,
    },
  ],
];

if (googleIosUrlScheme) {
  plugins.push([
    '@react-native-google-signin/google-signin',
    {
      iosUrlScheme: googleIosUrlScheme,
    },
  ]);
}

module.exports = {
  expo: {
    name: 'mobile',
    slug: 'mobile',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'mobile',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: 'com.webappdemo.mobile',
      icon: './assets/expo.icon',
      usesAppleSignIn: true,
    },
    android: {
      package: 'com.webappdemo.mobile',
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins,
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      eas: {
        projectId: 'a8541c8b-3024-42fb-9a9e-d0b878047b35',
      },
    },
  },
};
