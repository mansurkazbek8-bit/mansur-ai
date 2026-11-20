<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AiModel;
use App\Models\AppSetting;
use App\Services\AiGateway;
use App\Services\AiProviderException;
use App\Services\Providers;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Админ-панель → «Провайдеры»: API-ключи нейросетей (хранятся зашифрованными, наружу — только подсказка «AIza…1234»). */
class ProviderController extends Controller
{
    /** GET /api/admin/providers — провайдеры, откуда ключ (админка / .env) и сколько моделей включено. */
    public function index(): JsonResponse
    {
        $counts = AiModel::selectRaw('provider, count(*) as total, sum(case when is_active then 1 else 0 end) as active')
            ->groupBy('provider')->get()->keyBy('provider');

        return response()->json(['data' => collect(Providers::all())->map(fn ($p, $name) => [
            'name' => $name,
            'title' => $p['title'],
            'note' => $p['note'],
            'key_url' => $p['key_url'],
            'key_required' => $p['key_required'],
            'configured' => $p['enabled'],
            'key_source' => $p['key_source'],
            // Ключ целиком не показываем — только первые и последние 4 символа.
            'key_hint' => $p['key'] ? substr($p['key'], 0, 4).'…'.substr($p['key'], -4) : null,
            'models_total' => (int) ($counts[$name]->total ?? 0),
            'models_active' => (int) ($counts[$name]->active ?? 0),
        ])->values()]);
    }

    /** PUT /api/admin/providers/{provider} — сохранить ключ и сразу проверить его. */
    public function update(Request $request, string $provider, AiGateway $gateway): JsonResponse
    {
        abort_unless(Providers::get($provider), 404);
        $request->validate(['key' => ['nullable', 'string', 'max:500']]);

        $previous = AppSetting::find("provider_key:{$provider}")?->value;
        Providers::setKey($provider, $request->input('key'));

        // Неверный ключ отклоняется сразу (возвращаем старый), а не ломает потом чаты пользователей.
        if (filled($request->input('key')) && Providers::get($provider)['key_required']) {
            try {
                $gateway->remoteModels($provider);
            } catch (AiProviderException $e) {
                Providers::setKey($provider, $previous);
                abort(422, 'Ключ не подошёл: '.$e->getMessage().'. Проверьте, что скопировали именно API-ключ целиком.');
            }
        }

        return response()->json(['configured' => Providers::enabled($provider)]);
    }

    /** GET /api/admin/providers/{provider}/models — список моделей провайдера (заодно проверка ключа). */
    public function models(string $provider, AiGateway $gateway): JsonResponse
    {
        abort_unless(Providers::get($provider), 404);

        try {
            return response()->json(['data' => $gateway->remoteModels($provider)]);
        } catch (AiProviderException $e) {
            abort(422, $e->getMessage());
        }
    }

    /**
     * POST /api/admin/providers/{provider}/check — «постмортем одной кнопкой»: короткий живой запрос
     * к каждой модели провайдера; модели с ошибкой выключаются, рабочие включаются.
     */
    public function check(string $provider, AiGateway $gateway): JsonResponse
    {
        abort_unless(Providers::enabled($provider), 422, 'Сначала добавьте ключ провайдера');
        set_time_limit(600); // проверка многих моделей может идти несколько минут

        $results = AiModel::where('provider', $provider)->orderBy('sort')->get()->map(function (AiModel $model) use ($gateway) {
            $error = $gateway->ping($model);
            $model->update(['is_active' => $error === null]);

            return ['id' => $model->id, 'name' => $model->name, 'ok' => $error === null, 'error' => $error];
        });

        return response()->json(['data' => $results]);
    }
}
