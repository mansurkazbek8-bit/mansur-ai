<?php

namespace App\Http\Controllers;

use App\Http\Resources\AiModelResource;
use App\Models\AiModel;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/** Публичный каталог нейросетей (доступен и гостям). */
class AiModelController extends Controller
{
    /** GET /api/models — модели для чата: включённые, с настроенным провайдером, без моделей агента. */
    public function index(): AnonymousResourceCollection
    {
        return AiModelResource::collection(
            AiModel::available()->where('type', '!=', AiModel::TYPE_AGENT)->get()
        );
    }
}
