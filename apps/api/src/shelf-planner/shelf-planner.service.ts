import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Database, DatabaseTransaction } from '@pharmacy/database';
import {
  alphabetRanges,
  applyFixtureChanges,
  fixtureKey,
  pickPriorityFromSeconds,
  placeAlphabetically,
  plannerSlots,
  planPlacements,
  PERMISSIONS,
  shelfCode,
  slotTimings,
  suggestFixtureChanges,
  suggestNewFixtures,
  validateLayout,
  type AlphabetLevel,
  type ApplyShelfProposalRequest,
  type FixtureChange,
  type FixtureKind,
  type FixtureLayout,
  type FixtureRotation,
  type FloorPlan,
  type GenerateShelfProposalRequest,
  type MoveReason,
  type PlacementGrouping,
  type PlannerMedicine,
  type SaveShelfLayoutRequest,
  type ShelfPlacementRequest,
  type ShelfStorageClass,
  type SlotRef,
  type UnplacedReason,
} from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DATABASE } from '../database.module.js';

type Sql = Database | DatabaseTransaction;

interface FloorRow {
  readonly width_cm: number;
  readonly depth_cm: number;
  readonly counter_x_cm: number;
  readonly counter_y_cm: number;
  readonly counter_width_cm: number;
  readonly counter_depth_cm: number;
  readonly counter_rotation: number;
  readonly entrance_wall: FloorPlan['entrance']['wall'];
  readonly entrance_offset_cm: number;
  readonly entrance_width_cm: number;
  readonly version: number;
}

interface FixtureRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: FixtureKind;
  readonly x_cm: number;
  readonly y_cm: number;
  readonly width_cm: number;
  readonly depth_cm: number;
  readonly height_cm: number;
  readonly rotation: number;
  readonly level_count: number;
  readonly facings_per_level: number;
  readonly storage_class: ShelfStorageClass;
  readonly is_secured: boolean;
}

interface ShelfRow {
  readonly id: string;
  readonly fixture_id: string | null;
  readonly level_number: number | null;
  readonly code: string;
  readonly name: string;
  readonly label: string | null;
  readonly used: number;
}

export interface ShelfMedicineRow {
  readonly id: string;
  readonly name: string;
  readonly strength: string | null;
  readonly dosageForm: string | null;
  readonly company: string | null;
  readonly stock: string;
}

export interface MedicineSearchRow {
  readonly id: string;
  readonly name: string;
  readonly strength: string | null;
  readonly dosageForm: string | null;
  readonly company: string | null;
  readonly storageClass: ShelfStorageClass;
  readonly requiresSecured: boolean;
  readonly shelfCode: string | null;
  readonly shelfId: string | null;
}

interface Layout {
  readonly floor: FloorPlan | null;
  readonly version: number;
  readonly fixtures: FixtureLayout[];
}

export interface StoredMove {
  readonly medicineId: string;
  readonly name: string;
  readonly group: string;
  readonly picksPerMonth: number;
  readonly from: SlotRef | null;
  readonly fromLabel: string | null;
  readonly to: SlotRef;
  readonly toLabel: string;
  readonly reason: MoveReason;
  readonly secondsSavedPerMonth: number;
}

export interface StoredPayload {
  readonly fixtureChanges: readonly FixtureChange[];
  readonly fixtures: readonly FixtureLayout[];
  readonly moves: readonly StoredMove[];
  readonly unplaced: ReadonlyArray<{
    readonly medicineId: string;
    readonly name: string;
    readonly group: string;
    readonly reason: UnplacedReason;
  }>;
}

const FIXTURE_COLUMNS = `
  id::text, code, name, kind, x_cm, y_cm, width_cm, depth_cm, height_cm, rotation, level_count,
  facings_per_level, storage_class, is_secured`;

const STORAGE_WORDS: Readonly<Record<ShelfStorageClass, string>> = {
  AMBIENT: 'on an ordinary shelf',
  COLD: 'in the fridge',
  FROZEN: 'in the freezer',
  OTHER: 'in special storage',
};

function toFloor(row: FloorRow): FloorPlan {
  return {
    widthCm: row.width_cm,
    depthCm: row.depth_cm,
    counter: {
      xCm: row.counter_x_cm,
      yCm: row.counter_y_cm,
      widthCm: row.counter_width_cm,
      depthCm: row.counter_depth_cm,
      rotation: row.counter_rotation as FixtureRotation,
    },
    entrance: {
      wall: row.entrance_wall,
      offsetCm: row.entrance_offset_cm,
      widthCm: row.entrance_width_cm,
    },
  };
}

function toFixture(row: FixtureRow): FixtureLayout {
  return {
    key: fixtureKey(row.id),
    code: row.code,
    name: row.name,
    kind: row.kind,
    xCm: row.x_cm,
    yCm: row.y_cm,
    widthCm: row.width_cm,
    depthCm: row.depth_cm,
    heightCm: row.height_cm,
    rotation: row.rotation as FixtureRotation,
    levelCount: row.level_count,
    facingsPerLevel: row.facings_per_level,
    storageClass: row.storage_class,
    isSecured: row.is_secured,
  };
}

function idOf(key: string): string | null {
  return /^f\d+$/.test(key) ? key.slice(1) : null;
}

function groupFor(
  grouping: PlacementGrouping,
  row: {
    readonly name: string;
    readonly company: string | null;
    readonly dosage_form: string | null;
  },
): { key: string; label: string } {
  if (grouping === 'COMPANY') {
    const label = row.company?.trim() || 'No company';
    return { key: label.toLowerCase(), label };
  }
  if (grouping === 'FORM') {
    const form = row.dosage_form?.trim().toLowerCase() || 'other';
    return { key: form, label: form.charAt(0).toUpperCase() + form.slice(1) };
  }
  const letter = row.name.trim().charAt(0).toUpperCase();
  const label = /[A-Z]/.test(letter) ? letter : '#';
  return { key: label, label };
}

/**
 * Lock order for every planner write: the branch's floor plan row, then its fixtures, then shelves,
 * then medicine locations. Taking the floor plan row first serialises planner writes per branch.
 */
@Injectable()
export class ShelfPlannerService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  private async loadLayout(sql: Sql, branchId: string, lock = false): Promise<Layout> {
    const [floor] = lock
      ? await sql<FloorRow[]>`
          select * from shop_floor_plans where branch_id = ${branchId} for update`
      : await sql<FloorRow[]>`select * from shop_floor_plans where branch_id = ${branchId}`;
    const fixtures = lock
      ? await sql<FixtureRow[]>`
          select ${sql.unsafe(FIXTURE_COLUMNS)} from shelf_fixtures
          where branch_id = ${branchId} and is_active order by id for update`
      : await sql<FixtureRow[]>`
          select ${sql.unsafe(FIXTURE_COLUMNS)} from shelf_fixtures
          where branch_id = ${branchId} and is_active order by code, id`;
    return {
      floor: floor ? toFloor(floor) : null,
      version: floor?.version ?? 0,
      fixtures: fixtures.map(toFixture),
    };
  }

  private async lookbackDays(sql: Sql, branchId: string): Promise<number> {
    const [policy] = await sql<Array<{ days: number }>>`
      select shelf_lookback_days as days from operational_intelligence_policies
      where branch_id = ${branchId}`;
    return policy?.days ?? 30;
  }

  async state(user: AuthenticatedUser) {
    const layout = await this.loadLayout(this.database, user.branchId);
    const shelves = await this.database<ShelfRow[]>`
      select shelves.id::text, shelves.fixture_id::text, shelves.level_number, shelves.code,
        shelves.name, shelves.label, count(locations.medicine_id)::int as used
      from shelves
      left join medicine_shelf_locations locations
        on locations.shelf_id = shelves.id and locations.is_primary
      where shelves.branch_id = ${user.branchId} and shelves.is_active
      group by shelves.id
      order by shelves.code
    `;
    const [stats] = await this.database<
      Array<{ stocked: number; placed: number; unplaced: number }>
    >`
      with stocked as (
        select distinct medicine_id from inventory_batches
        where branch_id = ${user.branchId} and status = 'SELLABLE' and current_qty > 0
          and deleted_at is null
      ), placed as (
        select distinct locations.medicine_id from medicine_shelf_locations locations
        join shelves on shelves.id = locations.shelf_id
        where shelves.branch_id = ${user.branchId} and shelves.is_active and locations.is_primary
      )
      select (select count(*) from stocked)::int as stocked,
        (select count(*) from placed)::int as placed,
        (select count(*) from stocked
          where not exists (select 1 from placed where placed.medicine_id = stocked.medicine_id)
        )::int as unplaced
    `;
    const [pending] = await this.database<
      Array<{ id: string; createdAt: Date; summary: Record<string, unknown> }>
    >`
      select id::text, created_at as "createdAt", summary from shelf_layout_proposals
      where branch_id = ${user.branchId} and status = 'PENDING'
    `;
    const levels = new Map<
      string,
      Array<{ level: number; shelfId: string; code: string; label: string | null; used: number }>
    >();
    for (const shelf of shelves) {
      if (!shelf.fixture_id || shelf.level_number === null) continue;
      const key = fixtureKey(shelf.fixture_id);
      if (!levels.has(key)) levels.set(key, []);
      levels.get(key)!.push({
        level: shelf.level_number,
        shelfId: shelf.id,
        code: shelf.code,
        label: shelf.label,
        used: shelf.used,
      });
    }
    return {
      version: layout.version,
      floor: layout.floor,
      fixtures: layout.fixtures.map((fixture) => ({
        ...fixture,
        id: idOf(fixture.key),
        levels: (levels.get(fixture.key) ?? []).sort((a, b) => a.level - b.level),
      })),
      otherShelves: shelves
        .filter((shelf) => !shelf.fixture_id)
        .map((shelf) => ({ id: shelf.id, code: shelf.code, name: shelf.name, used: shelf.used })),
      stats: stats ?? { stocked: 0, placed: 0, unplaced: 0 },
      pendingProposal: pending ?? null,
      lookbackDays: await this.lookbackDays(this.database, user.branchId),
    };
  }

  async saveLayout(user: AuthenticatedUser, input: SaveShelfLayoutRequest) {
    return this.database.begin(async (transaction) => {
      const current = await this.loadLayout(transaction, user.branchId, true);
      if (input.expectedVersion !== current.version) {
        throw new ConflictException(
          'Someone else changed the shop layout. Reload the planner to see the latest version.',
        );
      }
      const existing = new Map(current.fixtures.map((fixture) => [idOf(fixture.key)!, fixture]));
      const kept = new Set<string>();
      for (const fixture of input.fixtures) {
        if (fixture.id === null) continue;
        const id = fixture.id.toString();
        if (!existing.has(id)) {
          throw new NotFoundException(`${fixture.name} no longer exists. Reload the planner.`);
        }
        if (kept.has(id)) throw new BadRequestException(`${fixture.name} is listed twice.`);
        kept.add(id);
      }
      const floor: FloorPlan = input.floor;
      const layouts: FixtureLayout[] = input.fixtures.map((fixture) => ({
        key: fixture.id === null ? `new:${fixture.key}` : fixtureKey(fixture.id.toString()),
        code: fixture.code,
        name: fixture.name,
        kind: fixture.kind,
        xCm: fixture.xCm,
        yCm: fixture.yCm,
        widthCm: fixture.widthCm,
        depthCm: fixture.depthCm,
        heightCm: fixture.heightCm,
        rotation: fixture.rotation,
        levelCount: fixture.levelCount,
        facingsPerLevel: fixture.facingsPerLevel,
        storageClass: fixture.storageClass,
        isSecured: fixture.isSecured,
      }));
      const issues = validateLayout(floor, layouts);
      const errors = issues.filter((issue) => issue.severity === 'error');
      if (errors.length > 0) {
        throw new BadRequestException(errors.map((issue) => issue.message).join(' '));
      }

      // Nothing may be lost: a removed fixture or level must be empty first.
      const held = await transaction<
        Array<{ fixture_id: string; level_number: number; held: number }>
      >`
        select shelves.fixture_id::text, shelves.level_number, count(*)::int as held
        from medicine_shelf_locations locations
        join shelves on shelves.id = locations.shelf_id
        where shelves.branch_id = ${user.branchId} and shelves.fixture_id is not null
          and shelves.is_active
        group by shelves.fixture_id, shelves.level_number
      `;
      for (const row of held) {
        const before = existing.get(row.fixture_id)!;
        const after = layouts.find((layout) => layout.key === fixtureKey(row.fixture_id));
        if (!after) {
          throw new ConflictException(
            `${before.name} (${before.code}) still holds medicines. Move them to another shelf before removing it.`,
          );
        }
        if (row.level_number > after.levelCount) {
          throw new ConflictException(
            `Level ${row.level_number} of ${before.name} (${before.code}) still holds ${row.held} medicines. Move them before removing the level.`,
          );
        }
        if (after.storageClass !== before.storageClass || (before.isSecured && !after.isSecured)) {
          throw new ConflictException(
            `${before.name} (${before.code}) holds medicines, so its storage type cannot change. Move them first.`,
          );
        }
      }

      const newCodes = new Set(
        layouts.flatMap((layout) =>
          Array.from({ length: layout.levelCount }, (_, index) =>
            shelfCode(layout.code, index + 1),
          ),
        ),
      );
      const clash = (
        await transaction<Array<{ code: string }>>`
          select code from shelves where branch_id = ${user.branchId} and fixture_id is null`
      ).find((shelf) => newCodes.has(shelf.code));
      if (clash) {
        throw new ConflictException(
          `Shelf code ${clash.code} is already used by an older shelf (Admin, Shelves). Give this rack a different label.`,
        );
      }

      // Park every planner fixture and shelf so codes can be reshuffled without colliding.
      await transaction`
        update shelf_fixtures set is_active = false, updated_at = now()
        where branch_id = ${user.branchId} and is_active`;
      await transaction`
        update shelves set is_active = false, code = '~' || id::text, updated_at = now()
        where branch_id = ${user.branchId} and fixture_id is not null`;

      const version = current.version + 1;
      await transaction`
        insert into shop_floor_plans (
          branch_id, width_cm, depth_cm, counter_x_cm, counter_y_cm, counter_width_cm,
          counter_depth_cm, counter_rotation, entrance_wall, entrance_offset_cm,
          entrance_width_cm, version, updated_by_user_id
        ) values (
          ${user.branchId}, ${floor.widthCm}, ${floor.depthCm}, ${floor.counter.xCm},
          ${floor.counter.yCm}, ${floor.counter.widthCm}, ${floor.counter.depthCm},
          ${floor.counter.rotation}, ${floor.entrance.wall}, ${floor.entrance.offsetCm},
          ${floor.entrance.widthCm}, ${version}, ${user.id}
        )
        on conflict (branch_id) do update set
          width_cm = excluded.width_cm, depth_cm = excluded.depth_cm,
          counter_x_cm = excluded.counter_x_cm, counter_y_cm = excluded.counter_y_cm,
          counter_width_cm = excluded.counter_width_cm,
          counter_depth_cm = excluded.counter_depth_cm,
          counter_rotation = excluded.counter_rotation, entrance_wall = excluded.entrance_wall,
          entrance_offset_cm = excluded.entrance_offset_cm,
          entrance_width_cm = excluded.entrance_width_cm, version = excluded.version,
          updated_by_user_id = excluded.updated_by_user_id, updated_at = now()
      `;
      const seconds = this.secondsByLevel(floor, layouts);
      for (const layout of layouts) {
        const id = await this.writeFixture(transaction, user.branchId, idOf(layout.key), layout);
        await this.writeLevels(transaction, user.branchId, id, layout, seconds);
      }
      await transaction`
        update shelf_layout_proposals set status = 'SUPERSEDED', decided_at = now()
        where branch_id = ${user.branchId} and status = 'PENDING'`;
      await this.audit(transaction, user, 'SHELF_LAYOUT.SAVED', 'shop_floor_plan', user.branchId, {
        version,
        fixtures: layouts.length,
        removed: [...existing.keys()].filter((id) => !kept.has(id)).length,
      });
      return {
        version,
        warnings: issues.filter((issue) => issue.severity === 'warning'),
      };
    });
  }

  private secondsByLevel(
    floor: FloorPlan,
    fixtures: readonly FixtureLayout[],
  ): Map<string, number> {
    return new Map(
      slotTimings(floor, fixtures).map((timing) => [
        `${timing.fixtureKey}#${timing.level}`,
        timing.secondsPerPick,
      ]),
    );
  }

  private async writeFixture(
    transaction: DatabaseTransaction,
    branchId: string,
    id: string | null,
    fixture: FixtureLayout,
  ): Promise<string> {
    if (id) {
      await transaction`
        update shelf_fixtures set code = ${fixture.code}, name = ${fixture.name},
          kind = ${fixture.kind}, x_cm = ${fixture.xCm}, y_cm = ${fixture.yCm},
          width_cm = ${fixture.widthCm}, depth_cm = ${fixture.depthCm},
          height_cm = ${fixture.heightCm}, rotation = ${fixture.rotation},
          level_count = ${fixture.levelCount}, facings_per_level = ${fixture.facingsPerLevel},
          storage_class = ${fixture.storageClass}, is_secured = ${fixture.isSecured},
          is_active = true, updated_at = now()
        where id = ${id} and branch_id = ${branchId}`;
      return id;
    }
    const [created] = await transaction<Array<{ id: string }>>`
      insert into shelf_fixtures (
        branch_id, code, name, kind, x_cm, y_cm, width_cm, depth_cm, height_cm, rotation,
        level_count, facings_per_level, storage_class, is_secured
      ) values (
        ${branchId}, ${fixture.code}, ${fixture.name}, ${fixture.kind}, ${fixture.xCm},
        ${fixture.yCm}, ${fixture.widthCm}, ${fixture.depthCm}, ${fixture.heightCm},
        ${fixture.rotation}, ${fixture.levelCount}, ${fixture.facingsPerLevel},
        ${fixture.storageClass}, ${fixture.isSecured}
      ) returning id::text`;
    if (!created) throw new Error('Fixture insert did not return an identifier');
    return created.id;
  }

  /** One shelf row per level, coded "A-1" (top) to "A-7", priced by seconds per pick. */
  private async writeLevels(
    transaction: DatabaseTransaction,
    branchId: string,
    fixtureId: string,
    fixture: FixtureLayout,
    seconds: ReadonlyMap<string, number>,
  ): Promise<void> {
    for (let level = 1; level <= fixture.levelCount; level += 1) {
      const priority = pickPriorityFromSeconds(seconds.get(`${fixture.key}#${level}`) ?? 600);
      await transaction`
        insert into shelves (
          branch_id, code, name, row_label, pick_priority, storage_class, is_secured,
          is_pick_location, is_active, fixture_id, level_number
        ) values (
          ${branchId}, ${shelfCode(fixture.code, level)}, ${`${fixture.name} · level ${level}`},
          ${`Level ${level}`}, ${priority}, ${fixture.storageClass}, ${fixture.isSecured},
          true, true, ${fixtureId}, ${level}
        )
        on conflict (fixture_id, level_number) where fixture_id is not null do update set
          code = excluded.code, name = excluded.name, row_label = excluded.row_label,
          pick_priority = excluded.pick_priority, storage_class = excluded.storage_class,
          is_secured = excluded.is_secured, is_pick_location = true, is_active = true,
          updated_at = now()
      `;
    }
  }

  async shelfMedicines(user: AuthenticatedUser, shelfId: bigint) {
    const id = shelfId.toString();
    const [shelf] = await this.database<Array<{ id: string; code: string }>>`
      select id::text, code from shelves
      where id = ${id} and branch_id = ${user.branchId} and is_active`;
    if (!shelf) throw new NotFoundException('Shelf not found');
    const data = await this.database<ShelfMedicineRow[]>`
      select medicines.id::text, medicines.name, medicines.strength,
        medicines.dosage_form as "dosageForm", manufacturers.name as company,
        coalesce(stock.quantity, 0)::text as stock
      from medicine_shelf_locations locations
      join medicines on medicines.id = locations.medicine_id
      left join manufacturers on manufacturers.id = medicines.manufacturer_id
      left join lateral (
        select sum(current_qty) as quantity from inventory_batches
        where branch_id = ${user.branchId} and medicine_id = medicines.id
          and status = 'SELLABLE' and deleted_at is null
      ) stock on true
      where locations.shelf_id = ${id} and locations.is_primary
      order by medicines.name, medicines.id
    `;
    return { shelf, data };
  }

  async searchMedicines(user: AuthenticatedUser, query: string) {
    const literal = query.replace(/[\\%_]/g, (character) => `\\${character}`);
    const contains = `%${literal}%`;
    const prefix = `${literal}%`;
    const data = await this.database<MedicineSearchRow[]>`
      select medicines.id::text, medicines.name, medicines.strength,
        medicines.dosage_form as "dosageForm", manufacturers.name as company,
        medicines.storage_class as "storageClass",
        medicines.requires_secured_storage as "requiresSecured",
        location.code as "shelfCode", location.shelf_id as "shelfId"
      from medicines
      left join manufacturers on manufacturers.id = medicines.manufacturer_id
      left join lateral (
        select shelves.code, shelves.id::text as shelf_id
        from medicine_shelf_locations locations join shelves on shelves.id = locations.shelf_id
        where locations.medicine_id = medicines.id and locations.is_primary
          and shelves.branch_id = ${user.branchId} and shelves.is_active
        order by shelves.id limit 1
      ) location on true
      where medicines.deleted_at is null
        and (medicines.name ilike ${contains} or medicines.generic_name ilike ${contains})
      order by (medicines.name ilike ${prefix}) desc, medicines.name, medicines.id
      limit 25
    `;
    return { data };
  }

  async place(user: AuthenticatedUser, input: ShelfPlacementRequest) {
    const shelfId = input.shelfId.toString();
    const medicineId = input.medicineId.toString();
    return this.database.begin(async (transaction) => {
      await transaction`
        select branch_id from shop_floor_plans where branch_id = ${user.branchId} for update`;
      const [shelf] = await transaction<
        Array<{ code: string; storage_class: ShelfStorageClass; is_secured: boolean }>
      >`
        select code, storage_class, is_secured from shelves
        where id = ${shelfId} and branch_id = ${user.branchId} and is_active for update`;
      if (!shelf) throw new NotFoundException('Shelf not found');
      const [medicine] = await transaction<
        Array<{ name: string; storage_class: ShelfStorageClass; requires_secured_storage: boolean }>
      >`
        select name, storage_class, requires_secured_storage from medicines
        where id = ${medicineId} and deleted_at is null`;
      if (!medicine) throw new NotFoundException('Medicine not found');
      if (medicine.storage_class !== shelf.storage_class) {
        throw new BadRequestException(
          `${medicine.name} must be kept ${STORAGE_WORDS[medicine.storage_class]}. Shelf ${shelf.code} is ${STORAGE_WORDS[shelf.storage_class].replace(/^(on|in) /, '')}.`,
        );
      }
      if (medicine.requires_secured_storage && !shelf.is_secured) {
        throw new BadRequestException(
          `${medicine.name} must be kept locked. Put it in a locked cabinet.`,
        );
      }
      await this.setPrimary(transaction, user.branchId, [
        { medicine_id: medicineId, shelf_id: shelfId },
      ]);
      await this.audit(transaction, user, 'SHELF.MEDICINE_PLACED', 'shelf', shelfId, {
        medicineId,
        code: shelf.code,
      });
      return { medicineId, shelfId, code: shelf.code };
    });
  }

  async remove(user: AuthenticatedUser, medicineId: bigint) {
    const id = medicineId.toString();
    return this.database.begin(async (transaction) => {
      await transaction`
        select branch_id from shop_floor_plans where branch_id = ${user.branchId} for update`;
      const removed = await transaction<Array<{ shelf_id: string }>>`
        delete from medicine_shelf_locations locations using shelves
        where shelves.id = locations.shelf_id and shelves.branch_id = ${user.branchId}
          and locations.medicine_id = ${id} and locations.is_primary
        returning locations.shelf_id::text`;
      if (removed.length === 0) throw new NotFoundException('That medicine is not on a shelf');
      await this.audit(transaction, user, 'SHELF.MEDICINE_REMOVED', 'medicine', id, {
        shelfIds: removed.map((row) => row.shelf_id),
      });
      return { medicineId: id, removed: true };
    });
  }

  /** Makes each listed shelf the medicine's one primary location in this branch. */
  private async setPrimary(
    transaction: DatabaseTransaction,
    branchId: string,
    rows: ReadonlyArray<{ medicine_id: string; shelf_id: string }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const payload = transaction.json(rows.map((row) => ({ ...row })));
    await transaction`
      delete from medicine_shelf_locations locations using shelves
      where shelves.id = locations.shelf_id and shelves.branch_id = ${branchId}
        and locations.is_primary
        and locations.medicine_id in (
          select medicine_id from jsonb_to_recordset(${payload}) as moved(medicine_id bigint)
        )`;
    await transaction`
      insert into medicine_shelf_locations (medicine_id, shelf_id, is_primary, location_type)
      select moved.medicine_id, moved.shelf_id, true, 'PRIMARY_PICK'
      from jsonb_to_recordset(${payload}) as moved(medicine_id bigint, shelf_id bigint)
      on conflict (medicine_id, shelf_id) do update
        set is_primary = true, location_type = 'PRIMARY_PICK'`;
  }

  async generateProposal(user: AuthenticatedUser, input: GenerateShelfProposalRequest) {
    const layout = await this.loadLayout(this.database, user.branchId);
    if (!layout.floor || layout.fixtures.length === 0) {
      throw new BadRequestException(
        'Draw your shop and save at least one rack before asking for a suggestion.',
      );
    }
    const floor = layout.floor;
    const lookbackDays = await this.lookbackDays(this.database, user.branchId);
    const slotOfShelf = new Map<string, SlotRef>();
    const codeOfShelf = new Map<string, string>();
    for (const shelf of await this.database<
      Array<{ id: string; fixture_id: string | null; level_number: number | null; code: string }>
    >`
      select id::text, fixture_id::text, level_number, code from shelves
      where branch_id = ${user.branchId} and is_active`) {
      codeOfShelf.set(shelf.id, shelf.code);
      if (shelf.fixture_id && shelf.level_number !== null) {
        slotOfShelf.set(shelf.id, {
          fixtureKey: fixtureKey(shelf.fixture_id),
          level: shelf.level_number,
        });
      }
    }
    const rows = await this.database<
      Array<{
        id: string;
        name: string;
        strength: string | null;
        dosage_form: string | null;
        company: string | null;
        storage_class: ShelfStorageClass;
        requires_secured_storage: boolean;
        picks: number;
        shelf_id: string | null;
      }>
    >`
      with stocked as (
        select medicine_id from inventory_batches
        where branch_id = ${user.branchId} and status = 'SELLABLE' and current_qty > 0
          and deleted_at is null
        group by medicine_id
      ), demand as (
        select sale_items.medicine_id, count(*)::int as picks
        from sale_items join sales on sales.id = sale_items.sale_id
        where sales.branch_id = ${user.branchId} and sales.status <> 'VOIDED'
          and sales.created_at >= now() - make_interval(days => ${lookbackDays})
        group by sale_items.medicine_id
      ), placed as (
        select distinct on (locations.medicine_id) locations.medicine_id, locations.shelf_id
        from medicine_shelf_locations locations join shelves on shelves.id = locations.shelf_id
        where shelves.branch_id = ${user.branchId} and shelves.is_active and locations.is_primary
        order by locations.medicine_id, locations.shelf_id
      ), candidates as (
        select medicine_id from stocked union select medicine_id from demand
        union select medicine_id from placed
      )
      select medicines.id::text, medicines.name, medicines.strength, medicines.dosage_form,
        manufacturers.name as company, medicines.storage_class,
        medicines.requires_secured_storage, coalesce(demand.picks, 0) as picks,
        placed.shelf_id::text as shelf_id
      from candidates
      join medicines on medicines.id = candidates.medicine_id and medicines.deleted_at is null
      left join manufacturers on manufacturers.id = medicines.manufacturer_id
      left join demand on demand.medicine_id = medicines.id
      left join placed on placed.medicine_id = medicines.id
    `;
    const details = new Map<string, { name: string; group: string; legacy: string | null }>();
    const medicines: PlannerMedicine[] = rows.map((row) => {
      const group = groupFor(input.grouping, row);
      const name = row.strength ? `${row.name} ${row.strength}` : row.name;
      const current = row.shelf_id ? (slotOfShelf.get(row.shelf_id) ?? null) : null;
      details.set(row.id, {
        name,
        group: group.label,
        legacy: row.shelf_id && !current ? (codeOfShelf.get(row.shelf_id) ?? null) : null,
      });
      return {
        id: row.id,
        name,
        groupKey: group.key,
        groupLabel: group.label,
        picksPerMonth: Math.round(((row.picks * 30) / lookbackDays) * 10) / 10,
        storageClass: row.storage_class,
        requiresSecured: row.requires_secured_storage,
        current,
      };
    });

    const picksByFixture = new Map<string, number>();
    for (const medicine of medicines) {
      if (!medicine.current) continue;
      const key = medicine.current.fixtureKey;
      picksByFixture.set(key, (picksByFixture.get(key) ?? 0) + medicine.picksPerMonth);
    }
    const layoutChanges = suggestFixtureChanges({
      floor,
      fixtures: layout.fixtures,
      picksByFixture,
    });
    let planned = applyFixtureChanges(layout.fixtures, layoutChanges);
    let plan = planPlacements({ slots: plannerSlots(floor, planned), medicines, mode: input.mode });
    const byId = new Map(medicines.map((medicine) => [medicine.id, medicine]));
    const shortfall = { ambient: 0, cold: 0, locked: 0 };
    for (const item of plan.unplaced) {
      if (item.reason === 'NO_LOCKED_SPACE') shortfall.locked += 1;
      else if (item.reason === 'NO_SPACE') shortfall.ambient += 1;
      else if (byId.get(item.medicineId)?.storageClass === 'COLD') shortfall.cold += 1;
    }
    const additions =
      shortfall.ambient + shortfall.cold + shortfall.locked > 0
        ? suggestNewFixtures({ floor, fixtures: planned, shortfall })
        : [];
    if (additions.length > 0) {
      planned = applyFixtureChanges(planned, additions);
      plan = planPlacements({ slots: plannerSlots(floor, planned), medicines, mode: input.mode });
    }
    const codeOf = new Map(planned.map((fixture) => [fixture.key, fixture.code]));
    const label = (slot: SlotRef): string =>
      shelfCode(codeOf.get(slot.fixtureKey) ?? '?', slot.level);
    const payload: StoredPayload = {
      fixtureChanges: [...layoutChanges, ...additions],
      fixtures: planned,
      moves: plan.moves.map((move) => {
        const detail = details.get(move.medicineId)!;
        return {
          medicineId: move.medicineId,
          name: detail.name,
          group: detail.group,
          picksPerMonth: byId.get(move.medicineId)!.picksPerMonth,
          from: move.from,
          fromLabel: move.from ? label(move.from) : detail.legacy,
          to: move.to,
          toLabel: label(move.to),
          reason: move.reason,
          secondsSavedPerMonth: move.secondsSavedPerMonth,
        };
      }),
      unplaced: plan.unplaced.map((item) => ({
        medicineId: item.medicineId,
        name: details.get(item.medicineId)!.name,
        group: details.get(item.medicineId)!.group,
        reason: item.reason,
      })),
    };
    const swapSeconds = layoutChanges.reduce(
      (sum, change) => sum + (change.type === 'SWAP' ? change.secondsSavedPerMonth : 0),
      0,
    );
    const summary = {
      mode: input.mode,
      grouping: input.grouping,
      lookbackDays,
      medicinesConsidered: medicines.length,
      withSales: medicines.filter((medicine) => medicine.picksPerMonth > 0).length,
      moveCount: payload.moves.length,
      newPlacements: payload.moves.filter((move) => move.from === null).length,
      fixtureChangeCount: payload.fixtureChanges.length,
      unplacedCount: payload.unplaced.length,
      secondsSavedPerMonth: Math.max(0, plan.secondsSavedPerMonth + swapSeconds),
    };
    const id = await this.database.begin(async (transaction) => {
      const [locked] = await transaction<Array<{ version: number }>>`
        select version from shop_floor_plans where branch_id = ${user.branchId} for update`;
      if (locked?.version !== layout.version) {
        throw new ConflictException('The shop layout changed while planning. Try again.');
      }
      await transaction`
        update shelf_layout_proposals set status = 'SUPERSEDED', decided_at = now()
        where branch_id = ${user.branchId} and status = 'PENDING'`;
      const [created] = await transaction<Array<{ id: string }>>`
        insert into shelf_layout_proposals (
          branch_id, layout_version, mode, grouping, payload, summary, created_by_user_id
        ) values (
          ${user.branchId}, ${layout.version}, ${input.mode}, ${input.grouping},
          ${transaction.json({ toJSON: () => payload })}, ${transaction.json(summary)}, ${user.id}
        ) returning id::text`;
      if (!created) throw new Error('Proposal insert did not return an identifier');
      await this.audit(
        transaction,
        user,
        'SHELF_PROPOSAL.CREATED',
        'shelf_layout_proposal',
        created.id,
        {
          moveCount: summary.moveCount,
          fixtureChangeCount: summary.fixtureChangeCount,
        },
      );
      return created.id;
    });
    return this.proposal(user, id);
  }

  async currentProposal(user: AuthenticatedUser) {
    const [pending] = await this.database<Array<{ id: string }>>`
      select id::text from shelf_layout_proposals
      where branch_id = ${user.branchId} and status = 'PENDING'`;
    return pending ? this.proposal(user, pending.id) : { data: null };
  }

  private async proposal(user: AuthenticatedUser, id: string) {
    const [row] = await this.database<
      Array<{
        id: string;
        status: string;
        layoutVersion: number;
        createdAt: Date;
        summary: Record<string, unknown>;
        payload: StoredPayload;
      }>
    >`
      select id::text, status, layout_version as "layoutVersion", created_at as "createdAt",
        summary, payload
      from shelf_layout_proposals where id = ${id} and branch_id = ${user.branchId}`;
    if (!row) throw new NotFoundException('Suggestion not found');
    const { payload, ...rest } = row;
    return { data: { ...rest, ...payload } };
  }

  async applyProposal(
    user: AuthenticatedUser,
    proposalId: bigint,
    input: ApplyShelfProposalRequest,
  ) {
    const id = proposalId.toString();
    return this.database.begin(async (transaction) => {
      const current = await this.loadLayout(transaction, user.branchId, true);
      const [proposal] = await transaction<
        Array<{ status: string; layout_version: number; payload: StoredPayload }>
      >`
        select status, layout_version, payload from shelf_layout_proposals
        where id = ${id} and branch_id = ${user.branchId} for update`;
      if (!proposal) throw new NotFoundException('Suggestion not found');
      if (proposal.status !== 'PENDING') {
        throw new ConflictException('This suggestion was already applied, rejected, or replaced.');
      }
      if (!current.floor || proposal.layout_version !== current.version) {
        throw new ConflictException(
          'The shop layout changed after this suggestion was made. Ask for a fresh suggestion.',
        );
      }
      const floor = current.floor;
      const offered = new Map(proposal.payload.fixtureChanges.map((change) => [change.id, change]));
      const accepted: FixtureChange[] = [];
      for (const changeId of new Set(input.fixtureChangeIds)) {
        const change = offered.get(changeId);
        if (!change)
          throw new BadRequestException('A selected rack change is not in this suggestion.');
        accepted.push(change);
      }
      if (accepted.length > 0 && !user.permissions.includes(PERMISSIONS.INVENTORY_SHELF_MANAGE)) {
        throw new ForbiddenException('Moving or adding racks needs the shelf manage permission.');
      }
      const next = applyFixtureChanges(current.fixtures, accepted);
      const errors = validateLayout(floor, next, { reachability: false }).filter(
        (issue) => issue.severity === 'error',
      );
      if (errors.length > 0) {
        throw new BadRequestException(errors.map((issue) => issue.message).join(' '));
      }

      const seconds = this.secondsByLevel(floor, next);
      const idByKey = new Map(current.fixtures.map((fixture) => [fixture.key, idOf(fixture.key)!]));
      const before = new Map(current.fixtures.map((fixture) => [fixture.key, fixture]));
      for (const fixture of next) {
        const existingId = idByKey.get(fixture.key);
        if (existingId) {
          const old = before.get(fixture.key)!;
          if (
            old.xCm !== fixture.xCm ||
            old.yCm !== fixture.yCm ||
            old.rotation !== fixture.rotation
          ) {
            await this.writeFixture(transaction, user.branchId, existingId, fixture);
          }
        } else {
          if (current.fixtures.some((other) => other.code === fixture.code)) {
            throw new ConflictException(`A rack labelled ${fixture.code} already exists.`);
          }
          idByKey.set(
            fixture.key,
            await this.writeFixture(transaction, user.branchId, null, fixture),
          );
        }
        if (accepted.length > 0) {
          await this.writeLevels(
            transaction,
            user.branchId,
            idByKey.get(fixture.key)!,
            fixture,
            seconds,
          );
        }
      }

      const fixtures = new Map(next.map((fixture) => [fixture.key, fixture]));
      const names = new Map(proposal.payload.moves.map((move) => [move.medicineId, move.name]));
      const seen = new Set<string>();
      const wanted: Array<{ medicineId: string; fixture: FixtureLayout; level: number }> = [];
      for (const move of input.moves) {
        const medicineId = move.medicineId.toString();
        const name = names.get(medicineId) ?? `Medicine ${medicineId}`;
        if (seen.has(medicineId)) throw new BadRequestException(`${name} is listed twice.`);
        seen.add(medicineId);
        const fixture = fixtures.get(move.fixtureKey);
        if (!fixture) {
          throw new BadRequestException(
            `${name} goes to a new rack you did not accept. Accept the rack or untick the medicine.`,
          );
        }
        if (move.level > fixture.levelCount) {
          throw new BadRequestException(
            `${fixture.name} (${fixture.code}) has no level ${move.level}.`,
          );
        }
        wanted.push({ medicineId, fixture, level: move.level });
      }
      const rules = new Map(
        (
          await transaction<
            Array<{
              id: string;
              name: string;
              storage_class: ShelfStorageClass;
              requires_secured_storage: boolean;
            }>
          >`
            select medicines.id::text, medicines.name, medicines.storage_class,
              medicines.requires_secured_storage
            from jsonb_to_recordset(${transaction.json(wanted.map((item) => ({ medicine_id: item.medicineId })))})
              as moved(medicine_id bigint)
            join medicines on medicines.id = moved.medicine_id and medicines.deleted_at is null`
        ).map((row) => [row.id, row]),
      );
      const shelves = new Map(
        (
          await transaction<Array<{ id: string; fixture_id: string; level_number: number }>>`
            select id::text, fixture_id::text, level_number from shelves
            where branch_id = ${user.branchId} and fixture_id is not null and is_active`
        ).map((shelf) => [`${shelf.fixture_id}#${shelf.level_number}`, shelf.id]),
      );
      const rows: Array<{ medicine_id: string; shelf_id: string }> = [];
      for (const item of wanted) {
        const rule = rules.get(item.medicineId);
        if (!rule) throw new NotFoundException(`Medicine ${item.medicineId} no longer exists.`);
        if (rule.storage_class !== item.fixture.storageClass) {
          throw new BadRequestException(
            `${rule.name} must be kept ${STORAGE_WORDS[rule.storage_class]}, not on ${item.fixture.name} (${item.fixture.code}).`,
          );
        }
        if (rule.requires_secured_storage && !item.fixture.isSecured) {
          throw new BadRequestException(`${rule.name} must be kept in a locked cabinet.`);
        }
        const shelfId = shelves.get(`${idByKey.get(item.fixture.key)}#${item.level}`);
        if (!shelfId)
          throw new ConflictException(
            `Shelf ${shelfCode(item.fixture.code, item.level)} is missing.`,
          );
        rows.push({ medicine_id: item.medicineId, shelf_id: shelfId });
      }
      await this.setPrimary(transaction, user.branchId, rows);

      const version = accepted.length > 0 ? current.version + 1 : current.version;
      if (accepted.length > 0) {
        await transaction`
          update shop_floor_plans set version = ${version}, updated_by_user_id = ${user.id},
            updated_at = now()
          where branch_id = ${user.branchId}`;
      }
      const applied = { fixtureChanges: accepted.length, moves: rows.length };
      await transaction`
        update shelf_layout_proposals set status = 'APPLIED', applied = ${transaction.json(applied)},
          decided_by_user_id = ${user.id}, decided_at = now()
        where id = ${id}`;
      await this.audit(
        transaction,
        user,
        'SHELF_PROPOSAL.APPLIED',
        'shelf_layout_proposal',
        id,
        applied,
      );
      return { ...applied, version };
    });
  }

  async rejectProposal(user: AuthenticatedUser, proposalId: bigint) {
    const id = proposalId.toString();
    return this.database.begin(async (transaction) => {
      const [rejected] = await transaction<Array<{ id: string }>>`
        update shelf_layout_proposals set status = 'REJECTED', decided_by_user_id = ${user.id},
          decided_at = now()
        where id = ${id} and branch_id = ${user.branchId} and status = 'PENDING'
        returning id::text`;
      if (!rejected) {
        throw new ConflictException('This suggestion was already applied, rejected, or replaced.');
      }
      await this.audit(
        transaction,
        user,
        'SHELF_PROPOSAL.REJECTED',
        'shelf_layout_proposal',
        id,
        {},
      );
      return { id, rejected: true };
    });
  }

  /** Gives a shelf level a short name staff use, such as "Antibiotic syrups". */
  async setShelfLabel(user: AuthenticatedUser, shelfId: bigint, label: string | null) {
    const id = shelfId.toString();
    return this.database.begin(async (transaction) => {
      const [shelf] = await transaction<Array<{ code: string }>>`
        update shelves set label = ${label}, updated_at = now()
        where id = ${id} and branch_id = ${user.branchId} and is_active
        returning code`;
      if (!shelf) throw new NotFoundException('Shelf not found');
      await this.audit(transaction, user, 'SHELF.LABELLED', 'shelf', id, {
        code: shelf.code,
        label: label ?? '',
      });
      return { shelfId: id, code: shelf.code, label };
    });
  }

  /**
   * Ordinary racks in A to Z reading order (rack label, then level 1 at the top). Fridges and
   * locked cabinets keep their own rules and are left out.
   */
  private async alphabetLevels(sql: Sql, branchId: string, exclude?: string) {
    const rows = await sql<
      Array<{
        shelf_id: string;
        fixture_id: string;
        code: string;
        fixture_code: string;
        level_number: number;
        label: string | null;
        capacity: number;
        medicines: Array<{ id: string; name: string }>;
      }>
    >`
      select shelves.id::text as shelf_id, shelf_fixtures.id::text as fixture_id, shelves.code,
        shelf_fixtures.code as fixture_code, shelves.level_number, shelves.label,
        shelf_fixtures.facings_per_level as capacity,
        coalesce((
          select json_agg(json_build_object('id', medicines.id::text, 'name', medicines.name))
          from medicine_shelf_locations locations
          join medicines on medicines.id = locations.medicine_id
          where locations.shelf_id = shelves.id and locations.is_primary
            and medicines.id::text <> ${exclude ?? ''}
        ), '[]'::json) as medicines
      from shelves join shelf_fixtures on shelf_fixtures.id = shelves.fixture_id
      where shelves.branch_id = ${branchId} and shelves.is_active and shelf_fixtures.is_active
        and shelf_fixtures.storage_class = 'AMBIENT' and not shelf_fixtures.is_secured
    `;
    rows.sort(
      (a, b) =>
        a.fixture_code.localeCompare(b.fixture_code, 'en', { numeric: true }) ||
        a.level_number - b.level_number,
    );
    const shelfBySlot = new Map<string, string>();
    const levels: AlphabetLevel[] = rows.map((row) => {
      const slot = { fixtureKey: fixtureKey(row.fixture_id), level: row.level_number };
      shelfBySlot.set(`${slot.fixtureKey}#${slot.level}`, row.shelf_id);
      return {
        slot,
        label: row.code,
        capacity: row.capacity,
        medicines: row.medicines,
      };
    });
    const labels = new Map(rows.map((row) => [row.shelf_id, row.label]));
    return { levels, shelfBySlot, labels };
  }

  async alphabet(user: AuthenticatedUser) {
    const { levels, shelfBySlot, labels } = await this.alphabetLevels(this.database, user.branchId);
    return {
      data: alphabetRanges(levels).map((range) => {
        const shelfId = shelfBySlot.get(`${range.slot.fixtureKey}#${range.slot.level}`)!;
        return { ...range, shelfId, shelfLabel: labels.get(shelfId) ?? null };
      }),
    };
  }

  /**
   * Where a medicine belongs on A to Z shelves and which neighbours shift to make room. With
   * apply, the place and the shifts are saved together, so the order never breaks halfway.
   */
  async alphabetPlace(user: AuthenticatedUser, medicineId: bigint, apply: boolean) {
    const id = medicineId.toString();
    const run = async (sql: Sql) => {
      const [medicine] = await sql<
        Array<{ name: string; storage_class: ShelfStorageClass; requires_secured_storage: boolean }>
      >`
        select name, storage_class, requires_secured_storage from medicines
        where id = ${id} and deleted_at is null`;
      if (!medicine) throw new NotFoundException('Medicine not found');
      if (medicine.storage_class !== 'AMBIENT' || medicine.requires_secured_storage) {
        throw new BadRequestException(
          `${medicine.name} is kept ${medicine.requires_secured_storage ? 'locked' : STORAGE_WORDS[medicine.storage_class]}, not on the A to Z racks.`,
        );
      }
      const { levels, shelfBySlot } = await this.alphabetLevels(sql, user.branchId, id);
      if (levels.length === 0) {
        throw new BadRequestException('Add ordinary racks in the shelf planner first.');
      }
      const placement = placeAlphabetically(levels, { id, name: medicine.name });
      if (!placement) {
        throw new ConflictException(
          'Every shelf after this place is full. Add a rack or raise medicines per level.',
        );
      }
      const shelfOf = (slot: SlotRef) => shelfBySlot.get(`${slot.fixtureKey}#${slot.level}`)!;
      return { medicine, placement, shelfOf };
    };
    if (!apply) {
      const { placement } = await run(this.database);
      return { ...placement, applied: false };
    }
    return this.database.begin(async (transaction) => {
      await transaction`
        select branch_id from shop_floor_plans where branch_id = ${user.branchId} for update`;
      const { medicine, placement, shelfOf } = await run(transaction);
      await this.setPrimary(transaction, user.branchId, [
        ...placement.moves.map((move) => ({
          medicine_id: move.medicineId,
          shelf_id: shelfOf(move.to),
        })),
        { medicine_id: id, shelf_id: shelfOf(placement.target) },
      ]);
      await this.audit(transaction, user, 'SHELF.ALPHABET_PLACED', 'medicine', id, {
        name: medicine.name,
        shelf: placement.targetLabel,
        shifted: placement.moves.length,
      });
      return { ...placement, applied: true };
    });
  }

  private async audit(
    transaction: DatabaseTransaction,
    actor: AuthenticatedUser,
    eventType: string,
    entityType: string,
    entityId: string,
    metadata: Readonly<Record<string, string | number | boolean | readonly string[]>>,
  ) {
    await transaction`
      insert into audit_events (
        branch_id, user_id, terminal_id, event_type, entity_type, entity_id, metadata
      ) values (
        ${actor.branchId}, ${actor.id}, ${actor.terminalId}, ${eventType}, ${entityType},
        ${entityId}, ${transaction.json(metadata)}
      )
    `;
  }
}
