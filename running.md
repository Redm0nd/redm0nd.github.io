---
layout: page
title: Running
permalink: /running/
---

My running journey and race records.

## Race Results

{% assign completed_races = site.data.races | where: "status", "completed" | sort: "date" | reverse %}
{% assign upcoming_races = site.data.races | where: "status", "upcoming" | sort: "date" %}

{% if upcoming_races.size > 0 %}
### Upcoming Races
<div class="table-container">
<table class="sortable-table upcoming-races">
  <thead>
    <tr>
      <th class="sortable" data-sort="date">Date ↕</th>
      <th class="sortable" data-sort="race">Race ↕</th>
      <th class="sortable" data-sort="distance">Distance ↕</th>
      <th class="sortable" data-sort="location">Location ↕</th>
      <th class="sortable" data-sort="notes">Notes ↕</th>
    </tr>
  </thead>
  <tbody>
    {% for race in upcoming_races %}
    <tr class="upcoming-race">
      <td data-sort-value="{{ race.date }}">{{ race.date | date: "%Y-%m-%d" }}</td>
      <td>{{ race.race }}</td>
      <td data-sort-value="{{ race.distance }}">{% if race.distance %}{{ race.distance }}km{% endif %}</td>
      <td>{{ race.location }}</td>
      <td>{{ race.notes }}</td>
    </tr>
    {% endfor %}
  </tbody>
</table>
</div>
{% endif %}

### Completed Races
<div class="table-container">
<table class="sortable-table completed-races">
  <thead>
    <tr>
      <th class="sortable" data-sort="date">Date ↕</th>
      <th class="sortable" data-sort="race">Race ↕</th>
      <th class="sortable" data-sort="distance">Distance ↕</th>
      <th class="sortable" data-sort="time">Time ↕</th>
      <th class="sortable" data-sort="location">Location ↕</th>
      <th class="sortable" data-sort="notes">Notes ↕</th>
    </tr>
  </thead>
  <tbody>
    {% for race in completed_races %}
    <tr>
      <td data-sort-value="{{ race.date }}">{{ race.date | date: "%Y-%m-%d" }}</td>
      <td>{{ race.race }}</td>
      <td data-sort-value="{{ race.distance }}">{% if race.distance %}{{ race.distance }}km{% endif %}</td>
      <td data-sort-value="{% if race.time %}{{ race.time | replace: ":", "" }}{% else %}999999{% endif %}">{{ race.time }}</td>
      <td>{{ race.location }}</td>
      <td>{{ race.notes }}</td>
    </tr>
    {% endfor %}
  </tbody>
</table>
</div>

## Training Goals

- [X] Sub-4 hour marathon
- [X] Sub-20 minute 5K
- [ ] Complete 100km in a month

## Personal Records


*Last updated: {{ site.time | date: "%B %Y" }}*

<style>
.table-container {
  overflow-x: auto;
  margin: 1rem 0;
}

.sortable-table {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
  font-size: 0.9em;
  min-width: 400px;
  box-shadow: 0 0 20px rgba(0, 0, 0, 0.15);
}

.sortable-table thead tr {
  background-color: var(--brand-color, #2a7ae4);
  color: #ffffff;
  text-align: left;
}

.upcoming-races thead tr {
  background-color: #28a745;
}

.sortable-table th,
.sortable-table td {
  padding: 12px 15px;
  border: 1px solid var(--table-border, #dddddd);
}

.sortable-table tbody tr {
  border-bottom: 1px solid var(--table-border, #dddddd);
}

.sortable-table tbody tr:nth-of-type(even) {
  background-color: var(--table-stripe, #f3f3f3);
}

.upcoming-race {
  background-color: #f8f9fa !important;
  border-left: 4px solid #28a745;
}

.upcoming-race:nth-of-type(even) {
  background-color: #e9ecef !important;
}

.sortable-table tbody tr:hover {
  background-color: var(--table-hover, #f1f1f1);
  cursor: pointer;
}

.sortable {
  cursor: pointer;
  user-select: none;
  position: relative;
}

.sortable:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.sortable.asc::after {
  content: ' ↑';
  color: #fff;
}

.sortable.desc::after {
  content: ' ↓';
  color: #fff;
}

/* Theme-aware styles are now handled in assets/css/style.scss */
</style>

<script>
document.addEventListener('DOMContentLoaded', function() {
  const tables = document.querySelectorAll('.sortable-table');

  tables.forEach(table => {
    const headers = table.querySelectorAll('.sortable');
    let currentSort = { column: null, direction: 'asc' };

    function parseTime(timeStr) {
      if (!timeStr || timeStr.trim() === '') return 999999;
      const parts = timeStr.split(':');
      if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseInt(parts[1]);
      } else if (parts.length === 3) {
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
      }
      return 999999;
    }

    function sortTable(column, direction) {
      const tbody = table.querySelector('tbody');
      const rows = Array.from(tbody.querySelectorAll('tr'));

      rows.sort((a, b) => {
        let aVal, bVal;
        const columnIndex = Array.from(headers).findIndex(h => h.dataset.sort === column);

        if (column === 'date') {
          aVal = new Date(a.cells[columnIndex].dataset.sortValue || a.cells[columnIndex].textContent);
          bVal = new Date(b.cells[columnIndex].dataset.sortValue || b.cells[columnIndex].textContent);
        } else if (column === 'race' || column === 'location' || column === 'notes') {
          aVal = a.cells[columnIndex].textContent.toLowerCase();
          bVal = b.cells[columnIndex].textContent.toLowerCase();
        } else if (column === 'distance') {
          aVal = parseFloat(a.cells[columnIndex].dataset.sortValue || '0');
          bVal = parseFloat(b.cells[columnIndex].dataset.sortValue || '0');
        } else if (column === 'time') {
          aVal = parseTime(a.cells[columnIndex].textContent);
          bVal = parseTime(b.cells[columnIndex].textContent);
        }

        if (aVal < bVal) return direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return direction === 'asc' ? 1 : -1;
        return 0;
      });

      rows.forEach(row => tbody.appendChild(row));
    }

    headers.forEach(header => {
      header.addEventListener('click', function() {
        const column = this.dataset.sort;
        let direction = 'asc';

        // Clear all headers in this table
        headers.forEach(h => {
          h.classList.remove('asc', 'desc');
          // Remove all existing arrows and reset to neutral
          const originalText = h.innerHTML.replace(/ [↑↓↕]/g, '');
          h.innerHTML = originalText + ' ↕';
        });

        // Determine sort direction
        if (currentSort.column === column && currentSort.direction === 'asc') {
          direction = 'desc';
        }

        // Update current sort
        currentSort = { column, direction };

        // Add class and arrow to current header
        this.classList.add(direction);
        // Remove neutral arrow and add appropriate directional arrow
        const originalText = this.innerHTML.replace(/ [↑↓↕]/g, '');
        this.innerHTML = originalText;

        // Sort the table
        sortTable(column, direction);
      });
    });

    // Default sort by date (newest first for completed, earliest for upcoming)
    if (table.classList.contains('completed-races')) {
      sortTable('date', 'desc');
      const dateHeader = table.querySelector('[data-sort="date"]');
      dateHeader.classList.add('desc');
      const originalText = dateHeader.innerHTML.replace(/ [↑↓↕]/g, '');
      dateHeader.innerHTML = originalText;
      currentSort = { column: 'date', direction: 'desc' };
    } else if (table.classList.contains('upcoming-races')) {
      sortTable('date', 'asc');
      const dateHeader = table.querySelector('[data-sort="date"]');
      dateHeader.classList.add('asc');
      const originalText = dateHeader.innerHTML.replace(/ [↑↓↕]/g, '');
      dateHeader.innerHTML = originalText;
      currentSort = { column: 'date', direction: 'asc' };
    }
  });
});
</script>