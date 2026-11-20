<?php

/*
| Консольные команды Artisan (запускаются в терминале: php artisan <команда>).
*/

use App\Models\User;
use App\Services\MailSettings;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Hash;

// Стандартная команда-пример Laravel: выводит цитату.
Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// php artisan mansur:check-public — проверка безопасности ПЕРЕД публикацией сайта в интернет.
// Её вызывает runtime/publish.ps1 и скрипт установки на VPS; при ошибке публикация останавливается (код выхода 1).
Artisan::command('mansur:check-public', function () {
    $ok = true;
    // Ищем администраторов со стандартным паролем: Hash::check сравнивает пароль с bcrypt-хешем из БД.
    $weak = User::where('role', User::ROLE_ADMIN)->get()
        ->filter(fn (User $u) => $u->password && collect(['admin12345', 'password', '12345678', 'admin123'])->contains(fn ($p) => Hash::check($p, $u->password)));
    foreach ($weak as $u) {
        $this->error("У администратора {$u->email} стандартный пароль. Войдите на сайт и смените его в профиле (не короче 8 символов).");
        $ok = false;
    }
    // Режим отладки показывает посетителю подробности ошибки (пути, ключи) — в интернете он должен быть выключен.
    if (config('app.debug')) {
        $this->error('Включён режим отладки APP_DEBUG=true: при ошибке посетители увидят секретные ключи. Поставьте APP_DEBUG=false в server/.env.');
        $ok = false;
    }
    // Почта не обязательна, поэтому только предупреждение.
    if (! MailSettings::ready()) {
        $this->warn('Почта не настроена: «Забыли пароль?» не будет отправлять письма (Админ-панель → Почта).');
    }

    if ($ok) {
        $this->info('Проверка пройдена: сайт можно открывать в интернет.');
    }

    return $ok ? 0 : 1;
})->purpose('Проверить, что сайт безопасно открывать в интернет');
