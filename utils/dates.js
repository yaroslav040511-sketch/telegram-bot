// utils/dates.js
function yearsMonths(totalMonths) {
  const months = Number(totalMonths) || 0;
  return {
    years: Math.floor(months / 12),
    months: months % 12
  };
}

module.exports = {
  yearsMonths
};
