#!/usr/bin/env bash
# Mansur AI — установка на чистый сервер Ubuntu 24.04 (VPS).
# Запуск от root:  bash setup.sh mansur.kz you@mail.com
#   1-й аргумент — домен сайта (его A-запись уже должна указывать на IP сервера)
#   2-й аргумент — email для сертификата HTTPS (Let's Encrypt)
# Проект должен лежать в /var/www/mansur-ai (папки server, desktop, deploy).
set -euo pipefail

DOMAIN="${1:?Укажите домен: bash setup.sh mansur.kz you@mail.com}"
EMAIL="${2:?Укажите email для сертификата HTTPS}"
APP=/var/www/mansur-ai
SRV=$APP/server
export DEBIAN_FRONTEND=noninteractive

echo "== 1/8 Пакеты: nginx, PHP 8.4, PostgreSQL 17, certbot"
apt-get update -y
apt-get install -y software-properties-common curl unzip git ca-certificates
add-apt-repository -y ppa:ondrej/php
apt-get install -y postgresql-common
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
apt-get update -y
apt-get install -y nginx postgresql-17 \
  php8.4-fpm php8.4-cli php8.4-pgsql php8.4-mbstring php8.4-xml php8.4-curl php8.4-zip php8.4-intl php8.4-bcmath php8.4-gd \
  certbot python3-certbot-nginx
if ! command -v composer >/dev/null; then
  curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
fi

echo "== 2/8 База данных"
DB_PASS=$(openssl rand -hex 16)
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='mansur'" | grep -q 1 \
  && sudo -u postgres psql -c "ALTER USER mansur WITH PASSWORD '$DB_PASS';" \
  || sudo -u postgres psql -c "CREATE USER mansur WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='mansur_ai'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE mansur_ai OWNER mansur;"

echo "== 3/8 Настройки .env"
ADMIN_PASS="Mansur-$(openssl rand -hex 5)"
if [ ! -f $SRV/.env ] || ! grep -q '^APP_ENV=production' $SRV/.env; then
  sed -e "s/DOMAIN/$DOMAIN/g" -e "s/DB_PASSWORD_HERE/$DB_PASS/" -e "s/ADMIN_PASSWORD_HERE/$ADMIN_PASS/" \
      $APP/deploy/env.production > $SRV/.env
else
  sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=$DB_PASS/" $SRV/.env
fi

echo "== 4/8 Зависимости и база"
cd $SRV
composer install --no-dev --optimize-autoloader --no-interaction
grep -q '^APP_KEY=base64' .env || php artisan key:generate --force
if [ -f $APP/deploy/mansur_ai.dump ]; then
  echo "   Переношу базу с компьютера (deploy/mansur_ai.dump)…"
  sudo -u postgres pg_restore --no-owner --role=mansur -d mansur_ai $APP/deploy/mansur_ai.dump || true
  php artisan migrate --force
  CREATED_ADMIN=0
else
  php artisan migrate --force --seed
  CREATED_ADMIN=1
fi
php artisan storage:link || true
php artisan config:cache && php artisan route:cache && php artisan view:cache

echo "== 5/8 Права на папки"
chown -R www-data:www-data $SRV/storage $SRV/bootstrap/cache
chmod -R ug+rwX $SRV/storage $SRV/bootstrap/cache

echo "== 6/8 nginx"
sed "s/DOMAIN/$DOMAIN/g" $APP/deploy/nginx-mansur.conf > /etc/nginx/sites-available/mansur-ai
ln -sf /etc/nginx/sites-available/mansur-ai /etc/nginx/sites-enabled/mansur-ai
rm -f /etc/nginx/sites-enabled/default
sed -i 's/^pm.max_children = .*/pm.max_children = 12/' /etc/php/8.4/fpm/pool.d/www.conf
sed -i 's/^;\?request_terminate_timeout = .*/request_terminate_timeout = 330/' /etc/php/8.4/fpm/pool.d/www.conf
nginx -t && systemctl reload nginx && systemctl restart php8.4-fpm

echo "== 7/8 HTTPS-сертификат"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo "== 8/8 Защита и резервные копии"
apt-get install -y ufw
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
mkdir -p /var/backups/mansur
cat > /etc/cron.daily/mansur-backup <<'CRON'
#!/bin/sh
# ежедневная копия базы, хранится 14 дней
sudo -u postgres pg_dump -Fc mansur_ai > /var/backups/mansur/mansur_ai-$(date +%F).dump
find /var/backups/mansur -name '*.dump' -mtime +14 -delete
CRON
chmod +x /etc/cron.daily/mansur-backup

php artisan mansur:check-public || true
echo
echo "======================================================"
echo " Готово: https://$DOMAIN"
[ "$CREATED_ADMIN" = 1 ] && echo " Администратор: admin@mansur.ai / $ADMIN_PASS  (смените в профиле)"
echo " Резервные копии базы: /var/backups/mansur (каждый день)"
echo "======================================================"
