/** Double round-robin fixture list via the circle method. Returns rounds of [home, away] team-index pairs. */
export function roundRobin(teamCount: number, seed = 0): [number, number][][] {
  const n = teamCount;
  const ids = Array.from({ length: n }, (_, i) => i);
  // rotate start order deterministically by seed for variety between careers
  for (let s = 0; s < seed % n; s++) ids.push(ids.shift()!);
  const rounds: [number, number][][] = [];
  const fixed = ids[0];
  let rest = ids.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const pairs: [number, number][] = [];
    const left = [fixed, ...rest.slice(0, n / 2 - 1)];
    const right = rest.slice(n / 2 - 1).reverse();
    for (let i = 0; i < n / 2; i++) {
      // alternate home/away so the fixed team isn't always home
      const home = (r + i) % 2 === 0 ? left[i] : right[i];
      const away = (r + i) % 2 === 0 ? right[i] : left[i];
      pairs.push([home, away]);
    }
    rounds.push(pairs);
    rest = [rest[rest.length - 1], ...rest.slice(0, rest.length - 1)];
  }
  const second = rounds.map((round) => round.map(([h, a]) => [a, h] as [number, number]));
  return [...rounds, ...second];
}

export interface TableRow {
  team: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  points: number;
}

export function computeTable(teamCount: number, results: Map<string, [number, number]>, fixtures: [number, number][][]): TableRow[] {
  const rows: TableRow[] = Array.from({ length: teamCount }, (_, team) => ({
    team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0,
  }));
  fixtures.forEach((round, r) => {
    round.forEach(([h, a], i) => {
      const res = results.get(`${r}:${i}`);
      if (!res) return;
      const [hg, ag] = res;
      const H = rows[h], A = rows[a];
      H.played++; A.played++;
      H.gf += hg; H.ga += ag; A.gf += ag; A.ga += hg;
      if (hg > ag) { H.won++; H.points += 3; A.lost++; }
      else if (hg < ag) { A.won++; A.points += 3; H.lost++; }
      else { H.drawn++; A.drawn++; H.points++; A.points++; }
    });
  });
  return rows.sort((x, y) =>
    y.points - x.points
    || (y.gf - y.ga) - (x.gf - x.ga)
    || y.gf - x.gf
    || x.team - y.team);
}
