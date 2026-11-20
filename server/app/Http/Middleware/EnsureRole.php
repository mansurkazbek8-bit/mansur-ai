<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Middleware «role:…»: пропускает только пользователей с нужной ролью.
 * Пример: role:admin в routes/api.php закрывает всю админ-панель для обычных пользователей (403).
 */
class EnsureRole
{
    /** ...$roles — список разрешённых ролей из записи role:admin,moderator. */
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        if (! in_array($request->user()?->role, $roles, true)) {
            abort(403, 'Недостаточно прав');
        }

        return $next($request);
    }
}
