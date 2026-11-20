<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;

/** Сведения о Windows-приложении для кнопки «Скачать». */
class AppInfoController extends Controller
{
    /** GET /api/app — версия, размер и ссылка на установщик (available=false, если файла нет на сервере). */
    public function show(): JsonResponse
    {
        $file = config('ai.desktop.file');
        $path = public_path($file);

        return response()->json([
            'version' => config('ai.desktop.version'),
            'available' => is_file($path),
            'size_mb' => is_file($path) ? round(filesize($path) / 1048576, 1) : null,
            'download_url' => asset($file),
        ]);
    }
}
