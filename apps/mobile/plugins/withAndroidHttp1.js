const { withMainApplication } = require('expo/config-plugins');

/**
 * Render/Cloudflare currently fails HTTP/2 (curl: framing layer error).
 * Android OkHttp uses HTTP/2 by default, so fetch() never reaches the API.
 * Force HTTP/1.1 for React Native networking.
 */
function withAndroidHttp1(config) {
  return withMainApplication(config, (modConfig) => {
    let src = modConfig.modResults.contents;
    if (src.includes('Protocol.HTTP_1_1')) {
      return modConfig;
    }

    const isKotlin = (modConfig.modResults.language || 'kt') === 'kt' || src.includes('override fun onCreate');
    if (!isKotlin) {
      throw new Error('withAndroidHttp1: expected Kotlin MainApplication');
    }

    const imports = [
      'import com.facebook.react.modules.network.OkHttpClientFactory',
      'import com.facebook.react.modules.network.OkHttpClientProvider',
      'import okhttp3.Protocol',
    ].filter((line) => !src.includes(line));
    if (imports.length) {
      src = src.replace(
        'import android.app.Application',
        `import android.app.Application\n${imports.join('\n')}`,
      );
    }

    const needle = 'super.onCreate()';
    const insert = `super.onCreate()
    OkHttpClientProvider.setOkHttpClientFactory(
      OkHttpClientFactory {
        OkHttpClientProvider.createClientBuilder()
          .protocols(listOf(Protocol.HTTP_1_1))
          .build()
      }
    )`;
    if (!src.includes(needle)) {
      throw new Error('withAndroidHttp1: could not find super.onCreate()');
    }
    src = src.replace(needle, insert);

    modConfig.modResults.contents = src;
    return modConfig;
  });
}

module.exports = withAndroidHttp1;
