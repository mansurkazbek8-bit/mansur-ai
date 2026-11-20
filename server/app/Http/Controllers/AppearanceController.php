<?php

namespace App\Http\Controllers;

use App\Http\Resources\UserResource;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/** Личное оформление: тема, цвета, шрифт, фон из фото / GIF / видео. Хранится в users.appearance (JSON). */
class AppearanceController extends Controller
{
    // Разрешённые шрифты (белый список).
    public const FONTS = ['Manrope', 'Inter', 'Montserrat', 'Rubik', 'Nunito', 'Comfortaa', 'Unbounded', 'System'];

    /** PUT /api/me/appearance — сохранить настройки оформления. */
    public function update(Request $request): UserResource
    {
        $hex = ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/']; // цвет в формате #RRGGBB
        $data = $request->validate([
            'theme' => ['required', 'in:dark,light,custom'],
            'accent' => $hex,
            'accent2' => $hex,
            'font' => ['nullable', 'in:'.implode(',', self::FONTS)],
            'bg_dim' => ['nullable', 'integer', 'min:0', 'max:90'],
            'bg_blur' => ['nullable', 'integer', 'min:0', 'max:30'],
            'glass' => ['nullable', 'boolean'],
            'animations' => ['nullable', 'boolean'],
            'radius' => ['nullable', 'integer', 'min:0', 'max:28'],
            'palette' => ['nullable', 'array', 'max:8'],
            'palette.*' => ['regex:/^#[0-9a-fA-F]{6}$/'],
        ]);

        $user = $request->user();
        $user->forceFill(['appearance' => $data])->save();

        return new UserResource($user);
    }

    /** POST /api/me/background — загрузить фон до 30 МБ. Тип файла проверяется по содержимому (mimetypes), а не по имени. */
    public function uploadBackground(Request $request): UserResource
    {
        $request->validate([
            'file' => ['required', 'file', 'max:30720', 'mimetypes:image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm'],
        ], ['file.max' => 'Файл больше 30 МБ', 'file.mimetypes' => 'Подходят фото (JPG, PNG, WebP), GIF или видео MP4/WebM']);

        $user = $request->user();
        $file = $request->file('file');
        $ext = strtolower($file->getClientOriginalExtension() ?: $file->extension());
        // Имя файла — случайный UUID: нельзя подобрать чужой файл и перезаписать существующий.
        $path = $file->storeAs("backgrounds/{$user->id}", Str::uuid().'.'.$ext, 'public');

        $this->deleteOld($user->background_path);
        $user->forceFill(['background_path' => $path])->save();

        return new UserResource($user);
    }

    /** DELETE /api/me/background — убрать свой фон. */
    public function deleteBackground(Request $request): Response
    {
        $user = $request->user();
        $this->deleteOld($user->background_path);
        $user->forceFill(['background_path' => null])->save();

        return response()->noContent();
    }

    /** Удалить старый файл фона с диска, чтобы не копился мусор. */
    private function deleteOld(?string $path): void
    {
        if ($path) {
            Storage::disk('public')->delete($path);
        }
    }
}
