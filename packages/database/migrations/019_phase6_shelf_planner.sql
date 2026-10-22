-- Shelf planner. The owner draws the shop (room size, counter, doorway) and every rack, fridge and
-- locked cabinet in it. Each level of a fixture is an ordinary shelf row (code "A-3"), so medicine
-- locations, counter search and the older ranking code keep working unchanged. Suggested
-- re-arrangements are stored as proposals the owner accepts item by item or rejects.

create table shop_floor_plans (
  branch_id bigint primary key references branches(id) on delete cascade,
  width_cm integer not null check (width_cm between 150 and 5000),
  depth_cm integer not null check (depth_cm between 150 and 5000),
  counter_x_cm integer not null,
  counter_y_cm integer not null,
  counter_width_cm integer not null check (counter_width_cm between 40 and 2000),
  counter_depth_cm integer not null check (counter_depth_cm between 30 and 400),
  counter_rotation integer not null check (counter_rotation in (0, 90, 180, 270)),
  entrance_wall text not null check (entrance_wall in ('NORTH', 'EAST', 'SOUTH', 'WEST')),
  entrance_offset_cm integer not null check (entrance_offset_cm >= 0),
  entrance_width_cm integer not null check (entrance_width_cm between 60 and 1000),
  -- Bumped on every layout change; proposals and saves carry the version they were based on.
  version integer not null default 1 check (version >= 1),
  updated_by_user_id bigint references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shop_floor_plans_updated_by_idx on shop_floor_plans (updated_by_user_id);

create table shelf_fixtures (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9]{1,6}$'),
  name text not null check (length(trim(name)) between 1 and 60),
  kind text not null
    check (kind in ('WALL_RACK', 'ISLAND_RACK', 'FRIDGE', 'SECURED_CABINET', 'DISPLAY')),
  x_cm integer not null,
  y_cm integer not null,
  width_cm integer not null check (width_cm between 20 and 2000),
  depth_cm integer not null check (depth_cm between 20 and 400),
  height_cm integer not null check (height_cm between 30 and 400),
  rotation integer not null check (rotation in (0, 90, 180, 270)),
  level_count integer not null check (level_count between 1 and 12),
  facings_per_level integer not null check (facings_per_level between 1 and 200),
  storage_class text not null check (storage_class in ('AMBIENT', 'COLD', 'FROZEN', 'OTHER')),
  is_secured boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shelf_fixtures_branch_idx on shelf_fixtures (branch_id, is_active, code);
create unique index shelf_fixtures_active_code_uidx
  on shelf_fixtures (branch_id, code) where is_active;

alter table shelves
  add column fixture_id bigint references shelf_fixtures(id) on delete restrict,
  add column level_number integer check (level_number between 1 and 12);

alter table shelves
  add constraint shelves_fixture_level_consistent
    check ((fixture_id is null) = (level_number is null));

create unique index shelves_fixture_level_uidx on shelves (fixture_id, level_number)
  where fixture_id is not null;

create table shelf_layout_proposals (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete cascade,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPLIED', 'REJECTED', 'SUPERSEDED')),
  layout_version integer not null check (layout_version >= 1),
  mode text not null check (mode in ('IMPROVE', 'FRESH')),
  grouping text not null check (grouping in ('COMPANY', 'FORM', 'NAME')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  summary jsonb not null check (jsonb_typeof(summary) = 'object'),
  applied jsonb check (applied is null or jsonb_typeof(applied) = 'object'),
  created_by_user_id bigint not null references users(id) on delete restrict,
  decided_by_user_id bigint references users(id) on delete restrict,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'PENDING') = (decided_at is null)),
  check ((status = 'APPLIED') = (applied is not null))
);
create index shelf_layout_proposals_branch_idx
  on shelf_layout_proposals (branch_id, status, id desc);
create unique index shelf_layout_proposals_one_pending_uidx
  on shelf_layout_proposals (branch_id) where status = 'PENDING';
create index shelf_layout_proposals_created_by_idx on shelf_layout_proposals (created_by_user_id);
create index shelf_layout_proposals_decided_by_idx on shelf_layout_proposals (decided_by_user_id);

-- Finding where a medicine sits in one branch joins locations to that branch's shelves.
create index shelves_branch_active_idx on shelves (branch_id, is_active, id);
