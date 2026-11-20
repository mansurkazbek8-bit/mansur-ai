<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\MailSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;
use Throwable;

/** Админ-панель → «Почта»: SMTP-настройки для писем сброса пароля. Пароль почты никогда не отдаётся обратно. */
class MailController extends Controller
{
    /** GET /api/admin/mail — текущие настройки (вместо пароля — только признак «заполнен»). */
    public function index(): JsonResponse
    {
        $s = MailSettings::stored();

        return response()->json([
            'configured' => MailSettings::adminConfigured(),
            'ready' => MailSettings::ready(),
            'host' => $s['host'] ?? '',
            'port' => $s['port'] ?? '',
            'username' => $s['username'] ?? '',
            'password_filled' => filled($s['password'] ?? null),
            'from_address' => $s['from_address'] ?? '',
            'from_name' => $s['from_name'] ?? '',
        ]);
    }

    /** PUT /api/admin/mail — сохранить настройки (хранятся зашифрованными в app_settings). */
    public function update(Request $request): JsonResponse
    {
        if ($request->boolean('clear')) {
            MailSettings::save(null);

            return $this->index();
        }
        $data = $request->validate([
            'host' => ['required', 'string', 'max:255'],
            'port' => ['required', 'integer', 'in:25,465,587,2525'],
            'username' => ['nullable', 'string', 'max:255'],
            'password' => ['nullable', 'string', 'max:255'],
            'from_address' => ['required', 'email', 'max:255'],
            'from_name' => ['nullable', 'string', 'max:100'],
        ]);
        $stored = MailSettings::stored();
        // Пустое поле пароля = оставить сохранённый. Пробелы убираем: Google показывает пароль приложения группами по 4.
        $data['password'] = filled($data['password'] ?? null) ? preg_replace('/\s+/', '', $data['password']) : ($stored['password'] ?? null);

        // Для Gmail проверяем частые ошибки: логин — полный адрес, пароль — 16 букв «пароля приложения».
        if (str_contains(strtolower($data['host']), 'gmail')) {
            $login = strtolower(trim((string) ($data['username'] ?? '')));
            if (! preg_match('/^[^@\s]+@(gmail|googlemail)\.com$/', $login)) {
                throw ValidationException::withMessages(['username' => 'Логин для Gmail — это полный адрес почты, например '.($data['from_address'] ?: 'name@gmail.com').'.']);
            }
            if (! preg_match('/^[a-z]{16}$/i', (string) $data['password'])) {
                throw ValidationException::withMessages(['password' => 'Это не пароль приложения. Обычный пароль от Gmail не подойдёт: создайте пароль приложения на myaccount.google.com/apppasswords — это 16 латинских букв.']);
            }
            $data['username'] = $login;
            $data['from_address'] = $login; // Gmail отправляет только от своего адреса
        }
        MailSettings::save(array_map(fn ($v) => is_string($v) ? trim($v) : $v, $data));

        return $this->index();
    }

    /** POST /api/admin/mail/test — отправить тестовое письмо и показать понятную ошибку, если не ушло. */
    public function test(Request $request): JsonResponse
    {
        $data = $request->validate(['to' => ['required', 'email']]);
        abort_unless(MailSettings::ready(), 422, 'Сначала сохраните настройки почты');
        MailSettings::apply();
        try {
            Mail::raw('Это тестовое письмо Mansur AI. Если вы его видите — письма для сброса пароля будут доходить.', fn ($m) => $m->to($data['to'])->subject('Тест почты Mansur AI'));
        } catch (Throwable $e) {
            abort(422, 'Письмо не отправлено: '.mb_strimwidth($e->getMessage(), 0, 220, '…'));
        }

        return response()->json(['message' => "Письмо отправлено на {$data['to']}"]);
    }
}
