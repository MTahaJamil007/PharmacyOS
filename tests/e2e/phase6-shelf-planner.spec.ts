import { expect, test, type Page, type Route } from '@playwright/test';

function json(route: Route, value: unknown, status = 200): Promise<void> {
  return route.fulfill({ body: JSON.stringify(value), contentType: 'application/json', status });
}

const OWNER = [
  'inventory.shelf.read',
  'inventory.shelf.manage',
  'inventory.shelf.recommendation.review',
];

async function signIn(page: Page, permissions: readonly string[]) {
  await page.addInitScript(
    (stored) => {
      localStorage.setItem('pharmacy-session', JSON.stringify(stored));
      localStorage.setItem('pharmacy-shelf-unit', 'ft');
      window.print = () => undefined;
    },
    {
      accessToken: 'shelf-token',
      absoluteExpiresAt: '2099-09-01T08:00:00.000Z',
      expiresAt: '2099-08-31T20:30:00.000Z',
      sessionId: 'shelf-session',
      user: {
        id: '7',
        branchId: '1',
        branchTimezone: 'Asia/Karachi',
        displayName: 'Shop Owner',
        permissions,
        terminalCode: 'BACK-1',
        terminalId: '2',
        terminalName: 'Back office',
        username: 'owner',
      },
    },
  );
}

interface SavedFixture {
  readonly id: string | null;
  readonly key: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly levelCount: number;
  readonly [field: string]: unknown;
}

/** A small in-memory shelf planner API: the layout the page saves is what it reads back. */
async function plannerApi(page: Page) {
  const captured: {
    layout: { floor: Record<string, unknown>; fixtures: SavedFixture[] } | null;
    placements: unknown[];
    proposalRequest: unknown;
    apply: { fixtureChangeIds: string[]; moves: Array<Record<string, unknown>> } | null;
  } = { layout: null, placements: [], proposalRequest: null, apply: null };
  let version = 0;
  let proposalOpen = false;
  const savedFixtures = () =>
    (captured.layout?.fixtures ?? []).map((fixture, index) => {
      const id = String(index + 1);
      return {
        ...fixture,
        id,
        key: `f${id}`,
        levels: Array.from({ length: fixture.levelCount }, (_, level) => ({
          level: level + 1,
          shelfId: `${id}0${level + 1}`,
          code: `${fixture.code}-${level + 1}`,
          used: id === '1' && level === 2 ? 2 : 0,
        })),
      };
    });
  const proposal = () => {
    const fixtures = savedFixtures();
    const fridge = fixtures.find((fixture) => fixture.kind === 'FRIDGE')!;
    return {
      id: '41',
      status: 'PENDING',
      layoutVersion: version,
      createdAt: '2026-10-22T10:00:00.000Z',
      summary: {
        mode: 'FRESH',
        grouping: 'FORM',
        lookbackDays: 30,
        medicinesConsidered: 3,
        withSales: 1,
        moveCount: 3,
        newPlacements: 2,
        fixtureChangeCount: 1,
        unplacedCount: 0,
        secondsSavedPerMonth: 5400,
      },
      fixtureChanges: [
        {
          id: 'rotate-f2',
          type: 'ROTATE',
          fixtureKey: 'f2',
          rotation: 180,
          reason: 'Wall rack (B) faces a wall. Turn it around so staff can pick from it.',
        },
      ],
      fixtures,
      moves: [
        {
          medicineId: '101',
          name: 'Panadol 500 mg',
          group: 'Tablets',
          picksPerMonth: 60,
          from: { fixtureKey: 'f3', level: 1 },
          fromLabel: 'C-1',
          to: { fixtureKey: 'f1', level: 3 },
          toLabel: 'A-3',
          reason: 'FAST_MOVER',
          secondsSavedPerMonth: 5400,
        },
        {
          medicineId: '102',
          name: 'Brufen 400 mg',
          group: 'Tablets',
          picksPerMonth: 0,
          from: null,
          fromLabel: null,
          to: { fixtureKey: 'f1', level: 4 },
          toLabel: 'A-4',
          reason: 'NOT_ON_SHELF',
          secondsSavedPerMonth: 0,
        },
        {
          medicineId: '103',
          name: 'Insulin 100 IU',
          group: 'Injection',
          picksPerMonth: 0,
          from: null,
          fromLabel: null,
          to: { fixtureKey: fridge.key, level: 2 },
          toLabel: `${fridge.code}-2`,
          reason: 'NOT_ON_SHELF',
          secondsSavedPerMonth: 0,
        },
      ],
      unplaced: [],
    };
  };

  await page.route('**/api/v1/**', (route) => json(route, {}));
  await page.route('**/api/v1/shelf-planner', (route) =>
    json(route, {
      version,
      floor: captured.layout?.floor ?? null,
      fixtures: savedFixtures(),
      otherShelves: [],
      stats: { stocked: 3190, placed: version > 0 ? 2 : 0, unplaced: version > 0 ? 3188 : 3190 },
      pendingProposal: null,
      lookbackDays: 30,
    }),
  );
  await page.route('**/api/v1/shelf-planner/layout', async (route) => {
    captured.layout = route.request().postDataJSON() as typeof captured.layout;
    version += 1;
    await json(route, { version, warnings: [] });
  });
  await page.route('**/api/v1/shelf-planner/proposals/current', (route) =>
    json(route, { data: proposalOpen ? proposal() : null }),
  );
  await page.route('**/api/v1/shelf-planner/proposals', async (route) => {
    captured.proposalRequest = route.request().postDataJSON();
    proposalOpen = true;
    await json(route, { data: proposal() });
  });
  await page.route('**/api/v1/shelf-planner/proposals/41/apply', async (route) => {
    captured.apply = route.request().postDataJSON() as typeof captured.apply;
    proposalOpen = false;
    await json(route, {
      fixtureChanges: captured.apply!.fixtureChangeIds.length,
      moves: captured.apply!.moves.length,
      version,
    });
  });
  await page.route('**/api/v1/shelf-planner/shelves/*/medicines', (route) =>
    json(route, {
      shelf: { id: '103', code: 'A-3' },
      data: [
        {
          id: '104',
          name: 'Calpol',
          strength: '120 mg',
          dosageForm: 'syrup',
          company: 'GSK',
          stock: '12',
        },
      ],
    }),
  );
  await page.route('**/api/v1/shelf-planner/medicines?*', (route) =>
    json(route, {
      data: [
        {
          id: '101',
          name: 'Panadol',
          strength: '500 mg',
          dosageForm: 'tablets',
          company: 'GSK',
          storageClass: 'AMBIENT',
          requiresSecured: false,
          shelfCode: 'C-1',
          shelfId: '301',
        },
      ],
    }),
  );
  await page.route('**/api/v1/shelf-planner/placements', async (route) => {
    captured.placements.push(route.request().postDataJSON());
    await json(route, { medicineId: '101', shelfId: '103', code: 'A-3' });
  });
  return captured;
}

test('an owner draws the shop from a size, edits it, and saves real shelf codes', async ({
  page,
}) => {
  await signIn(page, OWNER);
  const captured = await plannerApi(page);
  await page.goto('/#/shelves');

  await expect(page.getByRole('heading', { name: 'How big is your shop?' })).toBeVisible();
  await page.getByRole('button', { name: '12 × 30 ft' }).click();
  await expect(page.getByRole('img', { name: 'Starting layout preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Start with racks on the walls' }).click();

  const plan = page.getByRole('application', { name: /Shop floor plan/ });
  await expect(plan).toBeVisible();
  await expect(page.getByText('✓ Every rack can be reached and nothing overlaps.')).toBeVisible();
  const racks = plan.getByRole('button', { name: /^(Wall rack|Fridge|Locked cabinet) [A-Z]+$/ });
  const before = await racks.count();
  expect(before).toBeGreaterThanOrEqual(7);

  // Add a stand from the palette, remove it with Delete, and bring it back with Ctrl+Z.
  await page
    .getByRole('navigation', { name: 'Add to the shop' })
    .getByRole('button', { name: /Island stand/ })
    .click();
  const stand = plan.getByRole('button', { name: /^Island stand [A-Z]+$/ });
  await expect(stand).toHaveCount(1);
  await expect(page.getByRole('region', { name: /^Island stand/ })).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(stand).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(stand).toHaveCount(1);

  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(page.getByRole('button', { name: 'Saved ✓' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Saved');
  expect(captured.layout?.floor).toMatchObject({ widthCm: 366, depthCm: 914 });
  expect(captured.layout?.fixtures).toHaveLength(before + 1);
  expect(captured.layout?.fixtures.every((fixture) => fixture.id === null)).toBe(true);
  expect(captured.layout?.fixtures.map((fixture) => fixture.code)).toContain('A');

  // A saved rack lists its levels and takes medicines by typing their name.
  await plan.getByRole('button', { name: 'Wall rack A', exact: true }).click();
  await page.getByRole('button', { name: /^A-3/ }).click();
  await expect(page.getByRole('region', { name: 'Medicines on A-3' })).toContainText('Calpol');
  await page.getByRole('searchbox', { name: 'Add a medicine to A-3' }).fill('Pana');
  await page.getByRole('button', { name: /Panadol 500 mg.*move from C-1/ }).click();
  expect(captured.placements).toEqual([{ medicineId: '101', shelfId: '103' }]);
});

test('a suggestion can be reviewed, trimmed, retargeted, accepted and printed', async ({
  page,
}) => {
  await signIn(page, OWNER);
  const captured = await plannerApi(page);
  await page.goto('/#/shelves');
  await page.getByRole('button', { name: 'Start with racks on the walls' }).click();
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(page.getByRole('button', { name: 'Saved ✓' })).toBeVisible();

  await page.getByRole('button', { name: /Suggest a better layout/ }).click();
  const suggest = page.getByRole('region', { name: 'Suggest a better arrangement' });
  await suggest.getByText('Fresh arrangement').click();
  await suggest.getByText('By form (tablets, syrups…)').click();
  await suggest.getByRole('button', { name: 'Make a suggestion' }).click();
  expect(captured.proposalRequest).toEqual({ mode: 'FRESH', grouping: 'FORM' });

  const review = page.getByRole('region', { name: 'Suggested arrangement' });
  await expect(review).toContainText('1 h 30 min');
  await expect(review.getByRole('checkbox', { name: /Turn Wall rack B around/ })).toBeChecked();
  await review.getByRole('checkbox', { name: /Turn Wall rack B around/ }).uncheck();

  await review.getByRole('button', { name: /^A Wall rack/ }).click();
  await review.getByRole('checkbox', { name: 'Move Brufen 400 mg' }).uncheck();
  await review
    .getByRole('combobox', { name: 'New shelf for Panadol 500 mg' })
    .selectOption({ label: 'A-2' });
  await expect(review.getByRole('button', { name: 'Accept 2 moves' })).toBeVisible();
  await review.getByRole('button', { name: 'Accept 2 moves' }).click();

  expect(captured.apply?.fixtureChangeIds).toEqual([]);
  expect(captured.apply?.moves).toEqual([
    { medicineId: '101', fixtureKey: 'f1', level: 2 },
    expect.objectContaining({ medicineId: '103', level: 2 }),
  ]);
  const done = page.getByRole('region', { name: 'Suggestion applied' });
  await expect(done).toContainText('2 medicines have their new shelf');
  await done.getByRole('button', { name: 'Print move list' }).click();
  await done.getByRole('button', { name: 'Back to the shop' }).click();
  await expect(page.getByRole('region', { name: 'Shop' })).toBeVisible();
});

test('the 3D view shows every rack level and opens a level when it is clicked', async ({
  page,
}) => {
  await signIn(page, OWNER);
  await plannerApi(page);
  await page.goto('/#/shelves');
  await page.getByRole('button', { name: 'Start with racks on the walls' }).click();
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(page.getByRole('button', { name: 'Saved ✓' })).toBeVisible();

  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: '3D' }).click();
  const shop = page.getByRole('application', { name: /3D view of the shop/ });
  await expect(shop).toBeVisible();
  await expect(shop.getByRole('button', { name: /^A-1:/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Front' }).click();
  await shop.getByRole('button', { name: /^A-3:/ }).dispatchEvent('click');
  await expect(page.getByRole('region', { name: 'Medicines on A-3' })).toBeVisible();
  await page
    .getByRole('group', { name: 'Colour racks by' })
    .getByRole('button', { name: 'How full' })
    .click();
  await expect(page.getByText('over full')).toBeVisible();
});

test('staff with read access can find where a medicine is kept but cannot edit', async ({
  page,
}) => {
  await signIn(page, ['inventory.shelf.manage', 'inventory.shelf.read']);
  await plannerApi(page);
  await page.goto('/#/shelves');
  await page.getByRole('button', { name: 'Start with racks on the walls' }).click();
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(page.getByRole('button', { name: 'Saved ✓' })).toBeVisible();

  // Same layout, now opened by a salesperson.
  await page.addInitScript(() => {
    const stored = JSON.parse(localStorage.getItem('pharmacy-session') ?? '{}') as {
      user: { permissions: string[] };
    };
    stored.user.permissions = ['inventory.shelf.read'];
    localStorage.setItem('pharmacy-session', JSON.stringify(stored));
  });
  await page.reload();
  await expect(page.getByRole('application', { name: /Shop floor plan/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Save layout|Saved/ })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Add to the shop' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Suggest a better layout/ })).toHaveCount(0);

  await page.getByRole('searchbox', { name: 'Find where a medicine is kept' }).fill('Panadol');
  await page.getByRole('button', { name: /Panadol 500 mg\s*C-1/ }).click();
  await expect(page.getByRole('button', { name: /^C-1/ })).toHaveClass(/active/);
});
