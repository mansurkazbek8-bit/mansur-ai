<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\SocialAuth;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * Вход через Google / GitHub / Apple для сайта и Windows-приложения (протокол OAuth 2.0).
 *
 * Порядок: /auth/{provider} → страница входа провайдера → /auth/{provider}/callback → одноразовый код
 * → сайт (/?oauth_code=…) или локальный порт приложения (http://127.0.0.1:{port}/?code=…)
 * → POST /api/oauth/exchange меняет код на обычный токен API.
 * Сам токен никогда не передаётся в адресной строке — только короткоживущий одноразовый код.
 */
class SocialAuthController extends Controller
{
    /** GET /api/oauth/providers — какие кнопки «Войти через…» показать (только настроенные админом). */
    public function providers(): JsonResponse
    {
        return response()->json(['data' => collect(SocialAuth::enabled())
            ->map(fn ($p) => ['name' => $p, 'title' => SocialAuth::PROVIDERS[$p]['title']])]);
    }

    /** GET /auth/{provider} — шаг 1: отправить пользователя на страницу входа Google/GitHub/Apple. */
    public function redirect(Request $request, string $provider, SocialAuth $auth): RedirectResponse
    {
        $client = $request->query('client') === 'desktop' ? 'desktop' : 'web';
        $port = (int) $request->query('port');
        $target = ['client' => $client, 'port' => $client === 'desktop' && $port >= 1024 && $port <= 65535 ? $port : null];

        if (! SocialAuth::credentials($provider)) {
            return $this->back($target, 'Вход через этот сервис ещё не настроен администратором');
        }

        // state — случайная строка против CSRF-атаки: ответ провайдера примем, только если state совпадёт.
        $state = Str::random(40);
        Cache::put("oauth_state:{$state}", $target, now()->addMinutes(10));

        return redirect()->away($auth->authorizeUrl($provider, $state));
    }

    /** GET|POST /auth/{provider}/callback — шаг 2: провайдер вернул код, получаем профиль и находим/создаём пользователя. */
    public function callback(Request $request, string $provider, SocialAuth $auth): RedirectResponse
    {
        // pull = прочитать и сразу удалить: один state можно использовать только один раз.
        $target = Cache::pull('oauth_state:'.$request->input('state'));
        if (! $target) {
            return $this->back(['client' => 'web', 'port' => null], 'Ссылка входа устарела. Попробуйте ещё раз.');
        }
        if ($request->filled('error') || ! $request->filled('code')) {
            return $this->back($target, 'Вход отменён');
        }

        try {
            $extra = json_decode((string) $request->input('user'), true) ?: [];
            $user = $auth->findOrCreateUser($provider, $auth->profile($provider, $request->input('code'), $extra));
        } catch (Throwable $e) {
            Log::warning("OAuth {$provider}: ".$e->getMessage());

            return $this->back($target, $e instanceof \RuntimeException ? $e->getMessage() : 'Не удалось войти. Попробуйте ещё раз.');
        }
        if ($user->is_blocked) {
            return $this->back($target, 'Ваш аккаунт заблокирован администратором');
        }

        // Одноразовый код на 2 минуты вместо токена в адресной строке.
        $code = Str::random(48);
        Cache::put("oauth_code:{$code}", ['user_id' => $user->id, 'client' => $target['client']], now()->addMinutes(2));

        return $this->back($target, null, $code);
    }

    /** POST /api/oauth/exchange — шаг 3: одноразовый код → токен API (такой же ответ, как у /login). */
    public function exchange(Request $request, AuthController $authController): JsonResponse
    {
        $request->validate(['code' => ['required', 'string', 'max:100']]);
        $data = Cache::pull('oauth_code:'.$request->input('code'));
        abort_unless($data, 422, 'Код входа устарел. Попробуйте войти ещё раз.');

        return $authController->issueToken(User::findOrFail($data['user_id']), $data['client']);
    }

    /** Вернуть пользователя на сайт или в приложение (на его локальный порт) с кодом или текстом ошибки. */
    private function back(array $target, ?string $error, ?string $code = null): RedirectResponse
    {
        $query = http_build_query($code ? ($target['port'] ? ['code' => $code] : ['oauth_code' => $code]) : ($target['port'] ? ['error' => $error] : ['oauth_error' => $error]));

        return $target['port']
            ? redirect()->away("http://127.0.0.1:{$target['port']}/?{$query}")
            : redirect('/?'.$query);
    }
}
