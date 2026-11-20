<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\AiModelRequest;
use App\Http\Resources\AiModelResource;
use App\Models\AiModel;
use App\Services\Providers;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/** Админ-панель → «Нейросети»: CRUD моделей, лимитов и системных промптов, импорт моделей провайдера. */
class AiModelController extends Controller
{
    /** GET /api/admin/models — все модели (и выключенные) + состояние провайдеров. */
    public function index(): AnonymousResourceCollection
    {
        return AiModelResource::collection(AiModel::orderBy('sort')->get())
            ->additional(['providers' => collect(Providers::all())->map(fn ($p) => [
                'title' => $p['title'], 'configured' => $p['enabled'],
            ])]);
    }

    /** POST /api/admin/models — добавить нейросеть (201). */
    public function store(AiModelRequest $request): JsonResponse
    {
        return (new AiModelResource(AiModel::create($request->validated())))->response()->setStatusCode(201);
    }

    /** PUT /api/admin/models/{aiModel} — изменить (например, лимит или включить/выключить). */
    public function update(AiModelRequest $request, AiModel $aiModel): AiModelResource
    {
        $aiModel->update($request->validated());

        return new AiModelResource($aiModel);
    }

    /** DELETE /api/admin/models/{aiModel} — удалить модель. */
    public function destroy(AiModel $aiModel): Response
    {
        $aiModel->delete();

        return response()->noContent();
    }

    /** POST /api/admin/models/import — добавить сразу несколько моделей из списка провайдера. */
    public function import(Request $request): JsonResponse
    {
        $data = $request->validate([
            'provider' => ['required', Rule::in(array_keys(Providers::all()))],
            'models' => ['required', 'array', 'min:1', 'max:50'],
            'models.*.id' => ['required', 'string', 'max:150'],
            'models.*.name' => ['nullable', 'string', 'max:100'],
        ]);

        $sort = (int) AiModel::max('sort');
        $created = 0;
        foreach ($data['models'] as $m) {
            $slug = Str::limit(Str::slug($data['provider'].'-'.str_replace(['/', ':', '.'], '-', $m['id'])), 60, '');
            // firstOrCreate: если модель с таким slug уже есть — не дублируем.
            $model = AiModel::firstOrCreate(['slug' => $slug], [
                'name' => Str::limit($m['name'] ?: $m['id'], 100, ''),
                'provider' => $data['provider'],
                'model' => $m['id'],
                'type' => AiModel::TYPE_TEXT,
                'description' => 'Через '.Providers::get($data['provider'])['title'],
                'system_prompt' => 'Отвечай на языке пользователя, используй Markdown.',
                'daily_limit' => 50,
                'sort' => $sort += 10,
            ]);
            $created += (int) $model->wasRecentlyCreated;
        }

        return response()->json(['created' => $created], 201);
    }
}
