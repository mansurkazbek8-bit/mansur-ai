<?php

namespace App\Services;

use App\Models\AppSetting;
use App\Models\SocialAccount;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Вход через Google, GitHub и Apple (OAuth 2.0 / OpenID Connect) — без сторонних библиотек, на HTTP-клиенте Laravel.
 * Ключи приложений (client_id, client_secret) вводятся в админ-панели и хранятся зашифрованными в app_settings.
 */
class SocialAuth
{
    // Описание провайдеров: какие поля нужны и где их взять (подсказки показываются в админ-панели).
    public const PROVIDERS = [
        'google' => [
            'title' => 'Google',
            'fields' => ['client_id' => 'Client ID', 'client_secret' => 'Client secret'],
            'console_url' => 'https://console.cloud.google.com/apis/credentials',
            'note' => 'Google Cloud → «Учётные данные» → «Создать» → «Идентификатор клиента OAuth» → тип «Веб-приложение». В «Разрешённые URI перенаправления» вставьте адрес ниже.',
        ],
        'github' => [
            'title' => 'GitHub',
            'fields' => ['client_id' => 'Client ID', 'client_secret' => 'Client secret'],
            'console_url' => 'https://github.com/settings/applications/new',
            'note' => 'GitHub → Settings → Developer settings → OAuth Apps → New OAuth App. В «Authorization callback URL» вставьте адрес ниже.',
        ],
        'apple' => [
            'title' => 'Apple',
            'fields' => ['client_id' => 'Services ID', 'team_id' => 'Team ID', 'key_id' => 'Key ID', 'private_key' => 'Приватный ключ (.p8)'],
            'console_url' => 'https://developer.apple.com/account/resources/identifiers/list/serviceId',
            'note' => 'Нужен платный Apple Developer ($99/год) и сайт на настоящем домене с HTTPS — с localhost Apple не работает. Создайте Services ID с «Sign in with Apple», укажите адрес ниже в Return URLs, затем создайте ключ (Keys) и вставьте содержимое .p8.',
        ],
    ];

    /**
     * Ключи провайдера или null, если заполнены не все поля.
     *
     * @return array<string, string>|null
     */
    public static function credentials(string $provider): ?array
    {
        if (! isset(self::PROVIDERS[$provider]) || ! Schema::hasTable('app_settings')) {
            return null;
        }
        $stored = json_decode((string) AppSetting::find("oauth:{$provider}")?->value, true) ?: [];
        foreach (array_keys(self::PROVIDERS[$provider]['fields']) as $field) {
            if (blank($stored[$field] ?? null)) {
                return null;
            }
        }

        return $stored;
    }

    /** Сохранить ключи провайдера (null — удалить). */
    public static function setCredentials(string $provider, ?array $values): void
    {
        $id = "oauth:{$provider}";
        $values === null
            ? AppSetting::whereKey($id)->delete()
            : AppSetting::updateOrCreate(['key' => $id], ['value' => json_encode($values)]);
    }

    /**
     * Провайдеры, через которые уже можно войти.
     *
     * @return array<int, string>
     */
    public static function enabled(): array
    {
        return array_values(array_filter(array_keys(self::PROVIDERS), fn ($p) => self::credentials($p) !== null));
    }

    /** Адрес возврата после входа — его нужно вписать в настройках Google/GitHub (зависит от APP_URL). */
    public static function callbackUrl(string $provider): string
    {
        return rtrim(config('app.url'), '/')."/auth/{$provider}/callback";
    }

    /** Адрес страницы входа провайдера: client_id, куда вернуть, какие данные просим (scope) и state. */
    public function authorizeUrl(string $provider, string $state): string
    {
        $c = self::credentials($provider);

        return match ($provider) {
            'google' => 'https://accounts.google.com/o/oauth2/v2/auth?'.http_build_query([
                'client_id' => $c['client_id'], 'redirect_uri' => self::callbackUrl('google'), 'response_type' => 'code',
                'scope' => 'openid email profile', 'state' => $state, 'prompt' => 'select_account',
            ]),
            'github' => 'https://github.com/login/oauth/authorize?'.http_build_query([
                'client_id' => $c['client_id'], 'redirect_uri' => self::callbackUrl('github'),
                'scope' => 'read:user user:email', 'state' => $state, 'allow_signup' => 'true',
            ]),
            'apple' => 'https://appleid.apple.com/auth/authorize?'.http_build_query([
                'client_id' => $c['client_id'], 'redirect_uri' => self::callbackUrl('apple'), 'response_type' => 'code',
                'scope' => 'name email', 'response_mode' => 'form_post', 'state' => $state,
            ]),
        };
    }

    /**
     * Обменять код авторизации на профиль пользователя: id у провайдера, email, имя.
     *
     * @param  array<string, mixed>  $extra  Apple присылает имя только один раз, в отдельном поле «user».
     * @return array{id: string, email: ?string, name: ?string}
     */
    public function profile(string $provider, string $code, array $extra = []): array
    {
        $c = self::credentials($provider) ?? throw new RuntimeException('Вход через этот сервис не настроен');

        return match ($provider) {
            'google' => $this->google($c, $code),
            'github' => $this->github($c, $code),
            'apple' => $this->apple($c, $code, $extra),
        };
    }

    /**
     * Найти пользователя: 1) по привязанному аккаунту соцсети; 2) по подтверждённому email — и привязать;
     * 3) иначе зарегистрировать нового (без пароля — пароль можно задать потом в профиле).
     */
    public function findOrCreateUser(string $provider, array $profile): User
    {
        $account = SocialAccount::where('provider', $provider)->where('provider_id', $profile['id'])->first();
        if ($account) {
            return $account->user;
        }
        if (blank($profile['email'])) {
            throw new RuntimeException('Сервис не сообщил email. Разрешите доступ к email и попробуйте снова.');
        }

        return DB::transaction(function () use ($provider, $profile) {
            $user = User::whereRaw('lower(email) = ?', [Str::lower($profile['email'])])->first()
                ?? User::create([
                    'name' => Str::limit($profile['name'] ?: Str::before($profile['email'], '@'), 100, ''),
                    'email' => Str::lower($profile['email']),
                    'password' => null,
                ]);
            $user->socialAccounts()->create(['provider' => $provider, 'provider_id' => $profile['id']]);

            return $user;
        });
    }

    /** Google: код → access_token → профиль (email берём, только если Google его подтвердил). */
    private function google(array $c, string $code): array
    {
        $token = $this->exchange('https://oauth2.googleapis.com/token', [
            'client_id' => $c['client_id'], 'client_secret' => $c['client_secret'],
            'code' => $code, 'grant_type' => 'authorization_code', 'redirect_uri' => self::callbackUrl('google'),
        ]);
        $u = Http::withToken($token['access_token'])->get('https://openidconnect.googleapis.com/v1/userinfo')->throw()->json();

        return ['id' => (string) $u['sub'], 'email' => ($u['email_verified'] ?? false) ? $u['email'] : null, 'name' => $u['name'] ?? null];
    }

    /** GitHub: код → access_token → профиль и список email. */
    private function github(array $c, string $code): array
    {
        $token = $this->exchange('https://github.com/login/oauth/access_token', [
            'client_id' => $c['client_id'], 'client_secret' => $c['client_secret'],
            'code' => $code, 'redirect_uri' => self::callbackUrl('github'),
        ]);
        $gh = Http::withToken($token['access_token'])->withHeaders(['User-Agent' => 'Mansur-AI']);
        $u = $gh->get('https://api.github.com/user')->throw()->json();
        // Email в публичном профиле может быть скрыт — берём основной ПОДТВЕРЖДЁННЫЙ из списка адресов.
        $email = collect($gh->get('https://api.github.com/user/emails')->json() ?: [])
            ->filter(fn ($e) => $e['verified'] ?? false)->sortByDesc('primary')->first()['email'] ?? null;

        return ['id' => (string) $u['id'], 'email' => $email, 'name' => $u['name'] ?: $u['login']];
    }

    /** Apple: код → id_token (JWT) → данные пользователя из него. */
    private function apple(array $c, string $code, array $extra): array
    {
        $token = $this->exchange('https://appleid.apple.com/auth/token', [
            'client_id' => $c['client_id'], 'client_secret' => $this->appleClientSecret($c),
            'code' => $code, 'grant_type' => 'authorization_code', 'redirect_uri' => self::callbackUrl('apple'),
        ]);
        // id_token получен напрямую от Apple по защищённому каналу TLS, поэтому его можно прочитать без повторной проверки подписи.
        $claims = json_decode(base64_decode(strtr(explode('.', $token['id_token'])[1] ?? '', '-_', '+/')), true) ?: [];
        if (($claims['aud'] ?? null) !== $c['client_id'] || blank($claims['sub'] ?? null)) {
            throw new RuntimeException('Apple вернул некорректный ответ');
        }
        $name = trim(($extra['name']['firstName'] ?? '').' '.($extra['name']['lastName'] ?? ''));
        $verified = in_array($claims['email_verified'] ?? false, [true, 'true'], true);

        return ['id' => (string) $claims['sub'], 'email' => $verified ? ($claims['email'] ?? null) : null, 'name' => $name ?: null];
    }

    /** POST-запрос обмена кода на токен; понятная ошибка, если провайдер отказал (например, неверный client_secret). */
    private function exchange(string $url, array $params): array
    {
        $res = Http::asForm()->acceptJson()->post($url, $params);
        $data = $res->json() ?: [];
        if ($res->failed() || isset($data['error']) || blank($data['access_token'] ?? null)) {
            throw new RuntimeException('Сервис отклонил вход: '.($data['error_description'] ?? $data['error'] ?? 'HTTP '.$res->status()));
        }

        return $data;
    }

    /** Apple вместо постоянного секрета требует JWT на 10 минут, подписанный ключом .p8 (алгоритм ES256). */
    private function appleClientSecret(array $c): string
    {
        $b64 = fn (string $s) => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
        $input = $b64(json_encode(['alg' => 'ES256', 'kid' => $c['key_id']])).'.'.$b64(json_encode([
            'iss' => $c['team_id'], 'iat' => time(), 'exp' => time() + 600,
            'aud' => 'https://appleid.apple.com', 'sub' => $c['client_id'],
        ]));
        $key = openssl_pkey_get_private($c['private_key']) ?: throw new RuntimeException('Неверный приватный ключ Apple (.p8)');
        openssl_sign($input, $der, $key, OPENSSL_ALGO_SHA256);

        return $input.'.'.$b64($this->derToRawSignature($der));
    }

    /** OpenSSL выдаёт подпись в формате ASN.1 DER, а JWT нужна «сырая» форма r||s из 64 байт. */
    private function derToRawSignature(string $der): string
    {
        $offset = 3 + (ord($der[1]) & 0x80 ? ord($der[1]) & 0x7F : 0);
        $parts = [];
        for ($i = 0; $i < 2; $i++) {
            $len = ord($der[$offset]);
            $parts[] = str_pad(ltrim(substr($der, $offset + 1, $len), "\0"), 32, "\0", STR_PAD_LEFT);
            $offset += $len + 2;
        }

        return implode('', $parts);
    }
}
