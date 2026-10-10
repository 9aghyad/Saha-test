/** Platform bonus points applied once when a room ends. */
export function finalAwards(players, { teamGame = false, winningTeam = null } = {}) {
  if (teamGame) {
    return Object.fromEntries(players.map(player => [player.id, winningTeam && player.team === winningTeam ? 2 : 0]));
  }
  const sorted = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
  const awards = {};
  let previousScore;
  let rank = 0;
  sorted.forEach((player, index) => {
    const score = player.score || 0;
    if (index === 0 || score !== previousScore) rank = index + 1;
    awards[player.id] = rank === 1 ? 3 : rank === 2 ? 2 : rank === 3 ? 1 : 0;
    previousScore = score;
  });
  return awards;
}
