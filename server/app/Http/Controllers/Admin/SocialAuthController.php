<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AppSetting;
use App\Services\SocialAuth;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Админ-панель → «Вход через соцсети»: ключи OAuth-приложений Google / GitHub / Apple. */
class SocialAuthController extends Controller
{
    /** GET /api/admin/social — настройки и адрес callback, который нужно вписать у провайдера. */
    public function index(): JsonResponse
    {
        return response()->json(['data' => collect(SocialAuth::PROVIDERS)->map(function ($p, $name) {
            $stored = json_decode((string) AppSetting::find("oauth:{$name}")?->value, true) ?: [];

            return [
                'name' => $name,
                'title' => $p['title'],
                'note' => $p['note'],
                'console_url' => $p['console_url'],
                'callback_url' => SocialAuth::callbackUrl($name),
                'configured' => SocialAuth::credentials($name) !== null,
                // Секреты обратно не отдаются — показывается только публичный client_id.
                'fields' => collect($p['fields'])->map(fn ($label, $key) => [
                    'key' => $key,
                    'label' => $label,
                    'secret' => $key !== 'client_id' && $key !== 'team_id' && $key !== 'key_id',
                    'value' => in_array($key, ['client_id', 'team_id', 'key_id'], true) ? ($stored[$key] ?? '') : '',
                    'filled' => filled($stored[$key] ?? null),
                ])->values(),
            ];
        })->values()]);
    }

    /** PUT /api/admin/social/{provider} — сохранить ключи (clear=true — удалить). */
    public function update(Request $request, string $provider): JsonResponse
    {
        abort_unless(isset(SocialAuth::PROVIDERS[$provider]), 404);
        if ($request->boolean('clear')) {
            SocialAuth::setCredentials($provider, null);

            return response()->json(['configured' => false]);
        }

        $fields = array_keys(SocialAuth::PROVIDERS[$provider]['fields']);
        $request->validate(collect($fields)->mapWithKeys(fn ($f) => [$f => ['nullable', 'string', 'max:4000']])->all());

        // Пустое поле секрета = оставить сохранённое значение.
        $stored = json_decode((string) AppSetting::find("oauth:{$provider}")?->value, true) ?: [];
        foreach ($fields as $f) {
            if (filled($request->input($f))) {
                $stored[$f] = trim($request->input($f));
            }
        }
        if ($provider === 'apple' && filled($stored['private_key'] ?? null) && ! openssl_pkey_get_private($stored['private_key'])) {
            abort(422, 'Приватный ключ не распознан. Вставьте всё содержимое файла .p8 вместе со строками BEGIN/END.');
        }
        SocialAuth::setCredentials($provider, $stored);

        return response()->json(['configured' => SocialAuth::credentials($provider) !== null]);
    }
}
