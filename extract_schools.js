const fs = require('fs');
const data = JSON.parse(fs.readFileSync('judgesFJC.json', 'utf8'));
const schools = new Set();

function extractSchools(edu) {
  if (!edu) return;
  // Simple: split by space and collect phrases with school keywords
  const words = edu.split(/\s+/);
  let current = '';
  words.forEach(word => {
    current += (current ? ' ' : '') + word;
    if (current.includes('University') || current.includes('College') || current.includes('School') || current.includes('Law') || current.includes('Institute') || current.includes('Academy')) {
      if (current.length > 5) {
        schools.add(current);
        current = '';
      }
    } else if (word.match(/^\d{4}$/) || word.match(/^\(.*\)$/)) {
      // Reset on year or degree
      current = '';
    }
  });
}

function findJudges(obj) {
  if (Array.isArray(obj)) {
    obj.forEach(j => {
      if (j.education_items) {
        j.education_items.forEach(item => {
          if (item.school) schools.add(item.school);
        });
      }
    });
  } else if (obj && typeof obj === 'object') {
    for (const k in obj) {
      if (k === 'judges' && Array.isArray(obj[k])) {
        findJudges(obj[k]);
      } else {
        findJudges(obj[k]);
      }
    }
  }
}

findJudges(data);

console.log(Array.from(schools).sort().join('\n'));