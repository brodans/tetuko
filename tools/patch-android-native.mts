import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const root = join(process.cwd(), 'src-tauri', 'gen', 'android', 'app', 'src', 'main');
if (!existsSync(root)) {
  console.log('⚠️  Android project belum ada (src-tauri/gen/android/app/src/main). Jalankan tauri android init dulu.');
  process.exit(0);
}

// ── Regenerate Android mipmap icons dari icon TETUKO ───────────────────────
const iconSrc = join(process.cwd(), 'src-tauri', 'icons', 'icon.png');
const iconOut = join(tmpdir(), 'tauri-icons-' + randomBytes(4).toString('hex'));
const resDir = join(root, 'res');

if (existsSync(iconSrc)) {
  console.log('🎨 Generating Android icons dari icon TETUKO...');
  mkdirSync(iconOut, { recursive: true });
  try {
    execFileSync('npx', ['@tauri-apps/cli', 'icon', iconSrc, '-o', iconOut], {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    const mipmaps = ['mipmap-hdpi', 'mipmap-mdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi'];
    for (const mipmap of mipmaps) {
      const src = join(iconOut, 'android', mipmap);
      const dst = join(resDir, mipmap);
      try { cpSync(src, dst, { recursive: true }); console.log(`  ✅ ${mipmap}`); } catch { /* skip */ }
    }
    for (const extra of ['mipmap-anydpi-v26']) {
      const src = join(iconOut, 'android', extra);
      const dst = join(resDir, extra);
      try { cpSync(src, dst, { recursive: true }); console.log(`  ✅ ${extra}`); } catch { /* skip */ }
    }
    const bgXmlSrc = join(iconOut, 'android', 'values', 'ic_launcher_background.xml');
    const bgXmlDst = join(resDir, 'values', 'ic_launcher_background.xml');
    try { mkdirSync(dirname(bgXmlDst), { recursive: true }); cpSync(bgXmlSrc, bgXmlDst); console.log('  ✅ ic_launcher_background.xml'); } catch { /* skip */ }
    const splashIcon = join(resDir, 'drawable-nodpi/splash_icon.png');
    mkdirSync(dirname(splashIcon), { recursive: true });
    try { cpSync(join(iconOut, '128x128@2x.png'), splashIcon); } catch { try { cpSync(iconSrc, splashIcon); } catch { /* skip */ } }
  } catch (e) {
    console.warn('⚠️  Gagal generate icon Android:', e);
  }
}

const put = (file: string, content: string) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); };

// Splash
put(join(resDir, 'drawable/splash_screen.xml'), `<layer-list xmlns:android="http://schemas.android.com/apk/res/android"><item android:drawable="@color/splash_background"/><item><bitmap android:gravity="center" android:src="@drawable/splash_icon" /></item></layer-list>\n`);
put(join(resDir, 'values/colors.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="splash_background">#F8FAFC</color>
</resources>
`);
put(join(resDir, 'values-night/colors.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="splash_background">#0B1120</color>
</resources>
`);

// Network security config: izinkan cleartext ke localhost/127.0.0.1 untuk proxy lokal TETUKO
put(join(resDir, 'xml/network_security_config.xml'), `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
      <certificates src="user" />
    </trust-anchors>
  </base-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="true">127.0.0.1</domain>
    <domain includeSubdomains="true">localhost</domain>
    <domain includeSubdomains="true">10.0.2.2</domain>
  </domain-config>
</network-security-config>
`);

// ── Manifest patch ─────────────────────────────────────────────────────────
const manifestPath = join(root, 'AndroidManifest.xml');
if (existsSync(manifestPath)) {
  let manifest = readFileSync(manifestPath, 'utf8');

  // Network security config & cleartext (hindari duplikat atribut)
  if (/android:networkSecurityConfig\s*=/.test(manifest)) {
    manifest = manifest.replace(/android:networkSecurityConfig="[^"]*"/, 'android:networkSecurityConfig="@xml/network_security_config"');
  } else {
    manifest = manifest.replace(/<application\b/, '<application android:networkSecurityConfig="@xml/network_security_config"');
  }
  if (/android:usesCleartextTraffic\s*=/.test(manifest)) {
    manifest = manifest.replace(/android:usesCleartextTraffic="[^"]*"/, 'android:usesCleartextTraffic="true"');
  } else {
    manifest = manifest.replace(/<application\b/, '<application android:usesCleartextTraffic="true"');
  }

  const permissions = [
    'android.permission.INTERNET',
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.ACCESS_WIFI_STATE',
    'android.permission.CAMERA',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.READ_MEDIA_IMAGES',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.WAKE_LOCK',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
    'android.permission.RECEIVE_BOOT_COMPLETED',
    'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
  ];
  for (const perm of permissions) {
    if (!manifest.includes(perm)) {
      manifest = manifest.replace(/<application\b/, `<uses-permission android:name="${perm}" />\n    <application`);
    }
  }

  // Feature kamera opsional (jangan blokir device tanpa kamera tertentu)
  if (!manifest.includes('android.hardware.camera')) {
    manifest = manifest.replace(/<application\b/, `<uses-feature android:name="android.hardware.camera" android:required="false" />\n    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />\n    <application`);
  }

  // Foreground service + boot receiver untuk menjaga scheduler automasi
  if (!manifest.includes('TetukoForegroundService')) {
    const serviceTag = `
        <service
            android:name="id.tetuko.app.TetukoForegroundService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="specialUse">
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="Maintains user-enabled scheduled attendance automation while the app is in the background" />
        </service>

        <receiver
            android:name="id.tetuko.app.TetukoBootReceiver"
            android:enabled="true"
            android:exported="true"
            android:directBootAware="true">
            <intent-filter android:priority="999">
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
                <action android:name="android.intent.action.QUICKBOOT_POWERON" />
                <action android:name="android.intent.action.LOCKED_BOOT_COMPLETED" />
            </intent-filter>
        </receiver>
    </application>`;
    manifest = manifest.replace(/<\/application>/, serviceTag);
  }

  writeFileSync(manifestPath, manifest);
  console.log('✅ AndroidManifest.xml dipatch');
}

// ── Kotlin: Foreground Service ─────────────────────────────────────────────
const pkgDir = join(root, 'java/id/tetuko/app');
put(join(pkgDir, 'TetukoForegroundService.kt'), `package id.tetuko.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

class TetukoForegroundService : Service() {
  companion object {
    const val CHANNEL_ID = "tetuko_automation"
    const val NOTIF_ID = 2101
    const val ACTION_START = "id.tetuko.app.action.START_AUTOMATION"
    const val ACTION_STOP = "id.tetuko.app.action.STOP_AUTOMATION"
    const val EXTRA_TITLE = "extra_title"
    const val EXTRA_CONTENT = "extra_content"

    fun start(ctx: Context, title: String? = null, content: String? = null) {
      val intent = Intent(ctx, TetukoForegroundService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_TITLE, title ?: "TETUKO Automasi Aktif")
        putExtra(EXTRA_CONTENT, content ?: "Scheduler presensi berjalan di latar belakang")
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent) else ctx.startService(intent)
    }

    fun stop(ctx: Context) {
      val intent = Intent(ctx, TetukoForegroundService::class.java).apply { action = ACTION_STOP }
      ctx.startService(intent)
    }
  }

  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    createChannel()
    acquireWakeLock()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        releaseWakeLock()
        stopForeground(true)
        stopSelf()
        return START_NOT_STICKY
      }
      else -> {
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "TETUKO Automasi Aktif"
        val content = intent?.getStringExtra(EXTRA_CONTENT) ?: "Scheduler presensi berjalan di latar belakang"
        startForeground(NOTIF_ID, buildNotification(title, content))
        acquireWakeLock()
      }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    releaseWakeLock()
    super.onDestroy()
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val ch = NotificationChannel(CHANNEL_ID, "TETUKO Automasi", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Menjaga scheduler automasi presensi tetap aktif"
        setShowBadge(false)
      }
      nm.createNotificationChannel(ch)
    }
  }

  private fun buildNotification(title: String, content: String): Notification {
    val openIntent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE else PendingIntent.FLAG_UPDATE_CURRENT
    val pendingOpen = PendingIntent.getActivity(this, 0, openIntent, piFlags)

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(content)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(pendingOpen)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }

  private fun acquireWakeLock() {
    try {
      if (wakeLock?.isHeld == true) return
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "tetuko:automation").apply {
        setReferenceCounted(false)
        acquire()
      }
    } catch (_: Exception) {}
  }

  private fun releaseWakeLock() {
    try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) {}
    wakeLock = null
  }
}
`);
console.log('✅ TetukoForegroundService.kt ditulis');

// ── Kotlin: Boot Receiver ──────────────────────────────────────────────────
put(join(pkgDir, 'TetukoBootReceiver.kt'), `package id.tetuko.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class TetukoBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    val valid = action == Intent.ACTION_BOOT_COMPLETED ||
      action == Intent.ACTION_MY_PACKAGE_REPLACED ||
      action == Intent.ACTION_LOCKED_BOOT_COMPLETED ||
      action == "android.intent.action.QUICKBOOT_POWERON"
    if (!valid) return
    try {
      val prefs = context.getSharedPreferences("tetuko_automasi", Context.MODE_PRIVATE)
      val aktif = prefs.getBoolean("scheduler_aktif", false)
      if (!aktif) return

      TetukoForegroundService.start(
        context,
        "TETUKO Automasi Aktif",
        "Scheduler presensi aktif kembali setelah perangkat menyala"
      )

      // Best effort: bangunkan MainActivity agar runtime Tauri/Rust scheduler aktif.
      try {
        val launch = Intent(context, MainActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
          putExtra("tetuko_boot_resume", true)
        }
        context.startActivity(launch)
      } catch (_: Exception) {
        // Dibatasi Android pada beberapa perangkat; foreground service tetap dicoba.
      }
    } catch (_: Exception) {}
  }
}
`);
console.log('✅ TetukoBootReceiver.kt ditulis');

// ── Kotlin: Notification Helper ────────────────────────────────────────────
put(join(pkgDir, 'TetukoNotificationHelper.kt'), `package id.tetuko.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat

object TetukoNotificationHelper {
  private const val CHANNEL_ID = "tetuko_general"
  private var notifId = 3000

  fun showNotification(ctx: Context, title: String, message: String) {
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val ch = NotificationChannel(CHANNEL_ID, "TETUKO Notifikasi", NotificationManager.IMPORTANCE_DEFAULT)
      nm.createNotificationChannel(ch)
    }
    val notif = NotificationCompat.Builder(ctx, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(message)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .build()
    nm.notify(notifId++, notif)
  }
}
`);
console.log('✅ TetukoNotificationHelper.kt ditulis');

// ── MainActivity patch ─────────────────────────────────────────────────────
const activity = join(pkgDir, 'MainActivity.kt');
put(activity, `package id.tetuko.app

import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {

  inner class TetukoBridge {
    @JavascriptInterface
    fun setTheme(dark: Boolean) {
      mainHandler.post {
        appThemeIsDark = dark
        applySystemBarTheme()
      }
    }

    @JavascriptInterface
    fun startForegroundService(title: String?, content: String?) {
      mainHandler.post {
        try {
          TetukoForegroundService.start(this@MainActivity, title, content)
          getSharedPreferences("tetuko_automasi", android.content.Context.MODE_PRIVATE)
            .edit().putBoolean("scheduler_aktif", true).apply()
        } catch (e: Exception) { e.printStackTrace() }
      }
    }

    @JavascriptInterface
    fun stopForegroundService() {
      mainHandler.post {
        try {
          TetukoForegroundService.stop(this@MainActivity)
          getSharedPreferences("tetuko_automasi", android.content.Context.MODE_PRIVATE)
            .edit().putBoolean("scheduler_aktif", false).apply()
        } catch (e: Exception) { e.printStackTrace() }
      }
    }

    @JavascriptInterface
    fun requestNotificationPermission() {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
          checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
        mainHandler.post { requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 9913) }
      }
    }

    @JavascriptInterface
    fun requestBatteryOptimizationExemption() {
      mainHandler.post {
        try {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(android.content.Context.POWER_SERVICE) as? android.os.PowerManager
            if (pm != null && !pm.isIgnoringBatteryOptimizations(packageName)) {
              val intent = android.content.Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = android.net.Uri.parse("package:$packageName")
              }
              startActivity(intent)
            }
          }
        } catch (e: Exception) { e.printStackTrace() }
      }
    }

    @JavascriptInterface
    fun isIgnoringBatteryOptimizations(): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
      val pm = getSystemService(android.content.Context.POWER_SERVICE) as? android.os.PowerManager
      return pm?.isIgnoringBatteryOptimizations(packageName) == true
    }

    @JavascriptInterface
    fun showNotification(title: String, message: String): Boolean {
      mainHandler.post {
        try { TetukoNotificationHelper.showNotification(this@MainActivity, title, message) } catch (e: Exception) { e.printStackTrace() }
      }
      return true
    }
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private var bridgeInjected = false
  private var checkAttempts = 0
  private val maxCheckAttempts = 30
  private var cachedInsets: WindowInsetsCompat? = null
  private var appThemeIsDark = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isStatusBarContrastEnforced = false
      window.isNavigationBarContrastEnforced = false
    }

    val systemIsDark = (resources.configuration.uiMode and
      Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    appThemeIsDark = systemIsDark
    applySystemBarTheme()

    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { _, insets ->
      cachedInsets = insets
      val wv = findWebView(window.decorView)
      if (wv != null) sendInsetsToWeb(insets, wv)
      insets
    }
    startBridgeInjectionLoop()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    val systemIsDark = (newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    // Jangan menimpa pilihan tema eksplisit pengguna; hanya sinkronkan jika belum pernah diset bridge.
    if (!bridgeInjected) {
      appThemeIsDark = systemIsDark
      applySystemBarTheme()
    }
  }

  override fun onResume() {
    super.onResume()
    val wv = findWebView(window.decorView)
    if (wv != null) {
      if (!bridgeInjected) injectBridge(wv)
      else {
        val insets = cachedInsets ?: ViewCompat.getRootWindowInsets(window.decorView)
        if (insets != null) sendInsetsToWeb(insets, wv)
      }
    } else startBridgeInjectionLoop()
  }

  private fun startBridgeInjectionLoop() {
    if (bridgeInjected) return
    val wv = findWebView(window.decorView)
    if (wv != null) { injectBridge(wv); return }
    checkAttempts++
    if (checkAttempts < maxCheckAttempts) mainHandler.postDelayed({ startBridgeInjectionLoop() }, 200)
  }

  private fun injectBridge(wv: WebView) {
    if (bridgeInjected) return
    bridgeInjected = true
    wv.addJavascriptInterface(TetukoBridge(), "AndroidTetuko")
    wv.settings.domStorageEnabled = true
    wv.settings.databaseEnabled = true
    wv.settings.javaScriptCanOpenWindowsAutomatically = true
    wv.settings.mediaPlaybackRequiresUserGesture = false
    val cookieManager = android.webkit.CookieManager.getInstance()
    cookieManager.setAcceptCookie(true)
    cookieManager.setAcceptThirdPartyCookies(wv, true)
    val insets = cachedInsets ?: ViewCompat.getRootWindowInsets(window.decorView)
    if (insets != null) sendInsetsToWeb(insets, wv)
    applySystemBarTheme()
  }

  private fun applySystemBarTheme() {
    runOnUiThread {
      val isDark = appThemeIsDark
      val workspaceColor = if (isDark) Color.parseColor("#0B1120") else Color.parseColor("#F8FAFC")
      window.statusBarColor = Color.TRANSPARENT
      window.navigationBarColor = Color.TRANSPARENT
      window.decorView.setPadding(0, 0, 0, 0)
      window.setBackgroundDrawable(ColorDrawable(workspaceColor))
      window.decorView.setBackgroundColor(workspaceColor)
      findWebView(window.decorView)?.setBackgroundColor(workspaceColor)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        window.isStatusBarContrastEnforced = false
        window.isNavigationBarContrastEnforced = false
      }
      val controller = WindowCompat.getInsetsController(window, window.decorView)
      controller.isAppearanceLightStatusBars = !isDark
      controller.isAppearanceLightNavigationBars = !isDark
    }
  }

  private fun sendInsetsToWeb(insets: WindowInsetsCompat, targetWv: WebView? = null) {
    val wv = targetWv ?: findWebView(window.decorView) ?: return
    val statusBars = insets.getInsets(WindowInsetsCompat.Type.statusBars())
    val navBars = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
    val density = resources.displayMetrics.density
    val topDp = (statusBars.top / density).toInt()
    val bottomDp = (navBars.bottom / density).toInt()
    val leftDp = (statusBars.left / density).toInt()
    val rightDp = (statusBars.right / density).toInt()
    val script = """
      (function() {
        try {
          var top='\${topDp}px', bot='\${bottomDp}px', left='\${leftDp}px', right='\${rightDp}px';
          var root = document.documentElement;
          var body = document.body;
          root.style.setProperty('--sat', top);
          root.style.setProperty('--sab', bot);
          root.style.setProperty('--safe-area-inset-top', top);
          root.style.setProperty('--safe-area-inset-bottom', bot);
          root.style.setProperty('--safe-area-inset-left', left);
          root.style.setProperty('--safe-area-inset-right', right);
          root.style.setProperty('--poni-atas', top);
          root.style.setProperty('--poni-bawah', bot);
          root.style.setProperty('--poni-kiri', left);
          root.style.setProperty('--poni-kanan', right);
          if (body) body.classList.add('is-native');
          root.classList.add('is-native');
        } catch(e) {}
      })();
    """.trimIndent()
    wv.evaluateJavascript(script, null)
  }

  @Deprecated("Deprecated in Java")
  override fun onBackPressed() {
    val wv = findWebView(window.decorView)
    if (wv != null) {
      wv.evaluateJavascript(
        "(function(){try{var h=window.customBackHandlers||[];for(var i=h.length-1;i>=0;i--){var fn=h[i];if(typeof fn==='function'&&fn()===true){return 'handled';}}}catch(e){}return 'default';})()"
      ) { result ->
        val handled = result?.contains("handled") == true
        if (handled) return@evaluateJavascript
        runOnUiThread {
          if (wv.canGoBack()) wv.goBack() else super.onBackPressed()
        }
      }
      return
    }
    super.onBackPressed()
  }

  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        val found = findWebView(view.getChildAt(i))
        if (found != null) return found
      }
    }
    return null
  }
}
`);
console.log('✅ MainActivity.kt ditulis');

// ── Patch build.gradle.kts for release signing ─────────────────────────────
const gradlePath = join(process.cwd(), 'src-tauri', 'gen', 'android', 'app', 'build.gradle.kts');
if (existsSync(gradlePath)) {
  let gradle = readFileSync(gradlePath, 'utf8');
  if (!gradle.includes('signingConfigs')) {
    const signingBlock = `
    signingConfigs {
        create("release") {
            storeFile = file(System.getenv("ANDROID_KEYSTORE_PATH") ?: "/tmp/tetuko-release.jks")
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: ""
            keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: ""
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: ""
        }
    }
`;
    if (gradle.includes('buildTypes {')) {
      gradle = gradle.replace('buildTypes {', signingBlock + '    buildTypes {');
    } else {
      gradle = gradle.replace(/android\s*\{/, 'android {\n' + signingBlock);
    }
  }
  if (!gradle.includes('signingConfig = signingConfigs.getByName("release")')) {
    gradle = gradle.replace(
      /(getByName\("release"\)\s*\{)/,
      '$1\n            signingConfig = signingConfigs.getByName("release")'
    );
  }
  if (!gradle.includes('manifestPlaceholders["usesCleartextTraffic"]')) {
    gradle = gradle.replace(
      /(defaultConfig\s*\{)/,
      '$1\n        manifestPlaceholders["usesCleartextTraffic"] = "false"'
    );
  }
  writeFileSync(gradlePath, gradle);
  console.log('✅ build.gradle.kts dipatch untuk signing release');
}

console.log('✅ Patch Android native TETUKO selesai');
