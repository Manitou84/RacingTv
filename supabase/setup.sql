-- RacingTv: tabelle e regole per la multi utenza.
-- Da eseguire una volta in Supabase: SQL Editor → New query → incolla tutto → Run.

-- Utenti abilitati all'app (chi non è qui non può usarla, anche se ha un account Supabase)
create table if not exists public.racingtv_utenti (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome text not null unique,
  admin boolean not null default false,
  creato timestamptz not null default now()
);

-- Preferenze di ciascun utente: piloti preferiti, impostazioni, gare già viste...
create table if not exists public.racingtv_preferenze (
  user_id uuid primary key references auth.users(id) on delete cascade,
  dati jsonb not null default '{}'::jsonb check (pg_column_size(dati) < 65536), -- massimo 64 KB per utente
  aggiornato timestamptz not null default now()
);

alter table public.racingtv_utenti enable row level security;
alter table public.racingtv_preferenze enable row level security;

-- Ognuno vede solo la propria riga
drop policy if exists "vedo me stesso" on public.racingtv_utenti;
create policy "vedo me stesso" on public.racingtv_utenti for select using (user_id = auth.uid());

drop policy if exists "le mie preferenze" on public.racingtv_preferenze;
create policy "le mie preferenze" on public.racingtv_preferenze for all
  using (user_id = auth.uid() and exists (select 1 from public.racingtv_utenti u where u.user_id = auth.uid()))
  with check (user_id = auth.uid() and exists (select 1 from public.racingtv_utenti u where u.user_id = auth.uid()));

-- ---------- Funzioni per l'amministratore ----------
create or replace function public.racingtv_sono_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select admin from public.racingtv_utenti where user_id = auth.uid()), false);
$$;

create or replace function public.racingtv_admin_elenco()
returns table (user_id uuid, nome text, admin boolean, ultimo_accesso timestamptz)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.racingtv_sono_admin() then raise exception 'Solo l''amministratore può farlo'; end if;
  return query select u.user_id, u.nome, u.admin, a.last_sign_in_at
    from public.racingtv_utenti u join auth.users a on a.id = u.user_id order by u.nome;
end $$;

create or replace function public.racingtv_admin_abilita(p_user uuid, p_nome text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.racingtv_sono_admin() then raise exception 'Solo l''amministratore può farlo'; end if;
  insert into public.racingtv_utenti (user_id, nome) values (p_user, p_nome)
    on conflict (user_id) do update set nome = excluded.nome;
end $$;

create or replace function public.racingtv_admin_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if not public.racingtv_sono_admin() then raise exception 'Solo l''amministratore può farlo'; end if;
  if length(p_password) < 8 then raise exception 'La password deve avere almeno 8 caratteri'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
    where id = p_user;
end $$;

-- Crea un utente direttamente nel database: così la registrazione pubblica di Supabase può restare SPENTA
create or replace function public.racingtv_admin_crea(p_nome text, p_email text, p_password text)
returns uuid language plpgsql security definer set search_path = public, auth, extensions as $$
declare nuovo uuid := gen_random_uuid();
begin
  if not public.racingtv_sono_admin() then raise exception 'Solo l''amministratore può farlo'; end if;
  if p_nome !~ '^[a-z0-9._-]{2,30}$' then raise exception 'Nome utente non valido: usa lettere, numeri, punto o trattino'; end if;
  if length(p_password) < 8 then raise exception 'La password deve avere almeno 8 caratteri'; end if;
  if exists (select 1 from auth.users where email = lower(p_email)) or exists (select 1 from public.racingtv_utenti where nome = p_nome)
    then raise exception 'Esiste già un utente con questo nome'; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', nuovo, 'authenticated', 'authenticated', lower(p_email),
          extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), nuovo::text, nuovo,
          jsonb_build_object('sub', nuovo::text, 'email', lower(p_email), 'email_verified', true), 'email', now(), now(), now());
  insert into public.racingtv_utenti (user_id, nome) values (nuovo, p_nome);
  return nuovo;
end $$;

create or replace function public.racingtv_admin_elimina(p_user uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.racingtv_sono_admin() then raise exception 'Solo l''amministratore può farlo'; end if;
  if p_user = auth.uid() then raise exception 'Non puoi eliminare te stesso'; end if;
  delete from auth.users where id = p_user;
end $$;

-- Le funzioni si possono chiamare solo da utenti autenticati (e poi controllano che siano amministratori)
revoke all on function public.racingtv_admin_elenco() from public, anon;
revoke all on function public.racingtv_admin_abilita(uuid, text) from public, anon;
revoke all on function public.racingtv_admin_password(uuid, text) from public, anon;
revoke all on function public.racingtv_admin_crea(text, text, text) from public, anon;
revoke all on function public.racingtv_admin_elimina(uuid) from public, anon;
grant execute on function public.racingtv_admin_elenco(), public.racingtv_admin_abilita(uuid, text),
  public.racingtv_admin_password(uuid, text), public.racingtv_admin_crea(text, text, text),
  public.racingtv_admin_elimina(uuid) to authenticated;

-- Nessun accesso alle tabelle per chi non ha fatto login
revoke all on public.racingtv_utenti, public.racingtv_preferenze from anon;

-- ---------- Impostazioni da fare nel pannello di Supabase ----------
-- Authentication → Sign In / Providers: SPEGNI "Allow new users to sign up"
-- (gli utenti li crei solo tu, dal pannello dell'app o da qui).

-- ---------- Primo amministratore ----------
-- 1) Authentication → Users → Add user → Create new user:
--    email  alberto@racingtv.app  (il nome utente seguito da @racingtv.app), password a scelta, "Auto Confirm User" attivo.
-- 2) Poi esegui questa riga cambiando il nome:
-- insert into public.racingtv_utenti (user_id, nome, admin)
--   select id, 'alberto', true from auth.users where email = 'alberto@racingtv.app';
