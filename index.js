const { parseCSVFile } = require('./csv');

const getSaneMonsterName = (fullMonsterName) =>
  fullMonsterName
    .replace(/\s/g, '_')
    .replaceAll('-', '_')
    .replace(/[^\w_]/g, '');

const augmentsData = parseCSVFile('./augments.csv').map((augment) => ({
  name: augment.Augmentation,
  rank: augment.Rank,
  materials: augment.Materials,
  useInSearch: augment['Search?'] === '1',
}));

const zonesWeight = parseCSVFile('./zone_weights.csv').reduce(
  (acc, { Zone, Weight }) => ({
    ...acc,
    [Zone]: parseInt(Weight),
  }),
  {}
);

const generalZones = [
  ...new Set(Object.keys(zonesWeight).map((zoneName) => zoneName[0])),
];
const amountOfLevelsForZone =
  Object.keys(zonesWeight).length / generalZones.length;

const monstersData = parseCSVFile('./monsters.csv').map(
  ({ Objective, Materials, ...zones }) => ({
    name: getSaneMonsterName(Objective),
    fullname: Objective,
    materials: Materials,
    foundInZones: Object.fromEntries(
      Object.entries(zones).map(([zone, isFoundThere]) => [
        zone,
        isFoundThere === '1',
      ])
    ),
  })
);

const materialsToSearch = new Set(
  augmentsData
    .filter((augment) => augment.useInSearch)
    .reduce((acc, augment) => [...acc, ...augment.materials], [])
);

const monstersToSearch = monstersData.filter((monster) =>
  monster.materials.some((material) => materialsToSearch.has(material))
);

const zonesToSearch = new Set(
  monstersToSearch.reduce(
    (acc, { foundInZones }) => [
      ...acc,
      ...Object.entries(foundInZones)
        .filter(([_, isFoundThere]) => isFoundThere)
        .map(([zone]) => zone),
    ],
    []
  )
);

// LP
const { LinearProgram, Row } = require('lp_solve');
const lp = new LinearProgram();

const MINIMUM_ZONE_IMPORTANCE_FACTOR = 40;
const MINIMUM_LEVELED_ZONE_IMPORTANCE_FACTOR = 20;
const MINIMUM_MONSTERS_IMPORTANCE_FACTOR = 10;

// Add variables
monstersToSearch.forEach((monster) => lp.addColumn(monster.name, false, true));
generalZones.forEach((generalZone) => lp.addColumn(generalZone, false, true));
Object.keys(zonesWeight).forEach((zone) => lp.addColumn(zone, false, true));

// Objectives:
const objective = new Row();

// 1. Reduce the amount of zones
generalZones.forEach((generalZone) =>
  objective.Add(generalZone, MINIMUM_ZONE_IMPORTANCE_FACTOR)
);

// 2. Use the minimum levels for zones
zonesToSearch.forEach((zone) => {
  objective.Add(zone, zonesWeight[zone]);
});
objective.Multiply(MINIMUM_LEVELED_ZONE_IMPORTANCE_FACTOR);

// 3. Reduce the amount of monsters
monstersToSearch.forEach(({ name }) => {
  objective.Add(name, MINIMUM_MONSTERS_IMPORTANCE_FACTOR);
});

lp.setObjective(objective, true);

// Constraints:

// Material must be satisfied by killing a monster
const monstersThatGiveMaterial = [...materialsToSearch].reduce(
  (acc, material) => ({ ...acc, [material]: new Set() }),
  {}
);
materialsToSearch.forEach((materialToSearch) => {
  const constraint = new Row();
  monstersToSearch
    .filter((monster) => monster.materials.includes(materialToSearch))
    .forEach(({ name, foundInZones }) => {
      monstersThatGiveMaterial[materialToSearch].add({ name, foundInZones });
      constraint.Add(name, 1);
    });
  lp.addConstraint(
    constraint,
    'GE',
    1,
    `Material ${materialToSearch} must be satisfied by killing a monster`
  );
});

// Zones are activated when monster is killed there
monstersToSearch.forEach(({ name: monsterName, foundInZones }) => {
  const constraint = new Row();

  const foundInZoneNames = Object.entries(foundInZones)
    .filter(([_, isFoundThere]) => isFoundThere)
    .map(([zone]) => zone);

  constraint.Add(monsterName, 1);
  foundInZoneNames.forEach((zone) => {
    constraint.Subtract(zone, 1);
  });

  lp.addConstraint(
    constraint,
    'LE',
    0,
    `Zones are activated when ${monsterName} is killed there`
  );
});

// Monsters are killed non-negative times
monstersToSearch.forEach(({ name }) => {
  lp.addConstraint(
    new Row().Add(name, 1),
    'GE',
    0,
    'Monster is killed non-negative times'
  );
});

// Leveled zones activate general zones
generalZones.forEach((generalZone) => {
  const generalConstraint = new Row();
  generalConstraint.Add(generalZone, 1);
  for (let zoneLevel = 1; zoneLevel <= amountOfLevelsForZone; zoneLevel++) {
    generalConstraint.Subtract(`${generalZone}${zoneLevel}`, 1);
    console.log(generalZone, generalConstraint);
  }

  lp.addConstraint(
    generalConstraint,
    'LE',
    0,
    `General constraint for general zone ${generalZone}`
  );

  for (let zoneLevel = 1; zoneLevel <= amountOfLevelsForZone; zoneLevel++) {
    lp.addConstraint(
      new Row().Add(generalZone, 1).Subtract(`${generalZone}${zoneLevel}`, 1),
      'GE',
      0,
      `Particular constraint for general zone ${generalZone} and level ${zoneLevel}`
    );
  }
});

const materialsFromMonsters = new Set(
  monstersData.reduce((acc, { materials }) => [...acc, ...materials], [])
);
const materialsFromAugmentations = new Set(
  augmentsData.reduce((acc, { materials }) => [...acc, ...materials], [])
);
console.log(
  [...materialsFromAugmentations].filter(
    (material) => !materialsFromMonsters.has(material)
  )
);

// Solution
console.log(lp.dumpProgram())
lp.solve();
console.log('-----------------------------------------');
console.log('                MONSTERS                 ');
console.log('-----------------------------------------');
monstersToSearch.forEach(({ fullname, name }) => {
  if (lp.get(name) !== 0) console.log(`${fullname}: ${lp.get(name)}`);
});

console.log('-----------------------------------------');
console.log('                 IN ZONES                ');
console.log('-----------------------------------------');
zonesToSearch.forEach((zone) => {
  if (lp.get(zone) !== 0) console.log(`${zone}: ${lp.get(zone)}`);
});

console.log('-----------------------------------------');
console.log('            REQUIRES MATERIALS           ');
console.log('-----------------------------------------');
Object.entries(monstersThatGiveMaterial).forEach(([material, monsters]) => {
  console.log(
    `${material}`,
    [...monsters]
      .filter(({ name }) => lp.get(name))
      .map(({ name, foundInZones }) => {
        const zones = Object.entries(foundInZones)
          .filter(([_, isFoundThere]) => isFoundThere)
          .map(([zoneName]) => zoneName);

        return `${name} (${zones.join(', ')})`;
      })
  );
});
