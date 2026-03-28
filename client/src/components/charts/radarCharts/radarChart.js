import * as d3 from 'd3';

export function createRadarChart(container, data, {
  width, height, axisField, seriesField, valueField,
  colorScheme = 'blues', colors, animate = true, formatValue: fmtFn,
  fillOpacity = 0.2,
}) {
  const size = Math.min(width, height);
  const isCompact = width < 250 || height < 180;
  const isTiny = width < 160 || height < 120;
  let margin = 50;
  if (isTiny) margin = 10;
  else if (isCompact) margin = 20;
  const radius = (size - margin * 2) / 2;
  if (radius <= 0 || !data.length) return;

  const svg = d3.select(container)
    .selectAll('svg').data([null]).join('svg')
    .attr('width', width).attr('height', height);

  const cx = width / 2;
  const cy = height / 2;
  const g = svg.selectAll('g.radar-root').data([null]).join('g')
    .attr('class', 'radar-root')
    .attr('transform', `translate(${cx},${cy})`);

  const axes = [...new Set(data.map(d => d[axisField]))];
  const series = seriesField ? [...new Set(data.map(d => d[seriesField]))] : ['__single__'];
  const numAxes = axes.length;
  if (numAxes < 3) return;

  const angleSlice = (2 * Math.PI) / numAxes;

  const valMap = new Map();
  data.forEach(d => {
    const s = seriesField ? d[seriesField] : '__single__';
    valMap.set(`${s}|||${d[axisField]}`, +d[valueField] || 0);
  });

  const maxVal = d3.max([...valMap.values()]) || 1;
  const rScale = d3.scaleLinear().domain([0, maxVal]).range([0, radius]);

  const levels = 5;
  for (let lv = 1; lv <= levels; lv++) {
    const r = (radius / levels) * lv;
    g.selectAll(`circle.grid-${lv}`).data([null]).join('circle')
      .attr('class', `grid-${lv}`)
      .attr('r', r).attr('fill', 'none')
      .attr('stroke', '#333').attr('stroke-width', 0.5).attr('stroke-dasharray', '3,3');
  }

  axes.forEach((ax, i) => {
    const angle = i * angleSlice - Math.PI / 2;
    const x2 = Math.cos(angle) * radius;
    const y2 = Math.sin(angle) * radius;

    g.selectAll(`line.axis-${i}`).data([null]).join('line')
      .attr('class', `axis-${i}`)
      .attr('x1', 0).attr('y1', 0).attr('x2', x2).attr('y2', y2)
      .attr('stroke', '#444').attr('stroke-width', 0.5);

    const lx = Math.cos(angle) * (radius + 16);
    const ly = Math.sin(angle) * (radius + 16);
    g.selectAll(`text.axis-label-${i}`).data(isTiny ? [] : [null]).join('text')
      .attr('class', `axis-label-${i}`)
      .attr('x', lx).attr('y', ly)
      .attr('text-anchor', Math.abs(lx) < 5 ? 'middle' : (lx > 0 ? 'start' : 'end'))
      .attr('dominant-baseline', 'central')
      .attr('fill', '#888').attr('font-size', 10)
      .text(String(ax).length > 14 ? String(ax).slice(0, 12) + '…' : ax);
  });

  const seriesColors = colors && colors.length >= series.length
    ? colors.slice(0, series.length)
    : getSeriesColors(colorScheme, series.length);

  const tooltip = d3.select(container).selectAll('.radar-tooltip').data([null]).join('div')
    .attr('class', 'radar-tooltip')
    .style('position', 'absolute').style('pointer-events', 'none').style('opacity', 0)
    .style('background', 'rgba(20,20,30,0.95)').style('color', '#e0e0e0')
    .style('padding', '6px 10px').style('border-radius', '6px')
    .style('font-size', '12px').style('box-shadow', '0 2px 8px rgba(0,0,0,0.4)')
    .style('z-index', '100');

  const line = d3.lineRadial().curve(d3.curveLinearClosed);

  series.forEach((s, si) => {
    const points = axes.map((ax, i) => {
      const val = valMap.get(`${s}|||${ax}`) || 0;
      return [i * angleSlice - Math.PI / 2, rScale(val)];
    });

    const pathData = line(points);
    const areaPath = g.selectAll(`path.radar-area-${si}`).data([null]).join('path')
      .attr('class', `radar-area-${si}`)
      .attr('fill', seriesColors[si]).attr('fill-opacity', fillOpacity)
      .attr('stroke', seriesColors[si]).attr('stroke-width', 2);

    if (animate) {
      areaPath.attr('d', line(axes.map((_, i) => [i * angleSlice - Math.PI / 2, 0])))
        .transition().duration(800).ease(d3.easeCubicOut).attr('d', pathData);
    } else {
      areaPath.attr('d', pathData);
    }

    const pointsXY = axes.map((ax, i) => {
      const val = valMap.get(`${s}|||${ax}`) || 0;
      const angle = i * angleSlice - Math.PI / 2;
      return { ax, val, x: Math.cos(angle) * rScale(val), y: Math.sin(angle) * rScale(val), series: s };
    });

    g.selectAll(`circle.radar-dot-${si}`)
      .data(pointsXY, d => d.ax)
      .join('circle')
      .attr('class', `radar-dot-${si}`)
      .attr('cx', d => d.x).attr('cy', d => d.y).attr('r', 4)
      .attr('fill', seriesColors[si]).attr('stroke', '#1a1a24').attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .on('mouseenter', function(event, d) {
        const fmt = fmtFn || d3.format(',.1f');
        let html = `<strong>${d.ax}</strong>: ${fmt(d.val)}`;
        if (d.series !== '__single__') html = `<strong>${d.series}</strong><br/>` + html;
        tooltip.html(html).style('opacity', 1);
      })
      .on('mousemove', function(event) {
        const rect = container.getBoundingClientRect();
        tooltip.style('left', `${event.clientX - rect.left + 12}px`).style('top', `${event.clientY - rect.top - 10}px`);
      })
      .on('mouseleave', () => tooltip.style('opacity', 0));
  });

  if (series.length > 1 && series[0] !== '__single__') {
    const legend = svg.selectAll('g.radar-legend').data([null]).join('g')
      .attr('class', 'radar-legend').attr('transform', `translate(${width - 20}, 20)`);

    series.forEach((s, i) => {
      const row = legend.selectAll(`g.legend-${i}`).data([null]).join('g')
        .attr('class', `legend-${i}`).attr('transform', `translate(0, ${i * 18})`);
      row.selectAll('rect').data([null]).join('rect')
        .attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', seriesColors[i]);
      row.selectAll('text').data([null]).join('text')
        .attr('x', -8).attr('y', 9).attr('text-anchor', 'end')
        .attr('fill', '#aaa').attr('font-size', 10)
        .text(String(s).length > 16 ? String(s).slice(0, 14) + '…' : s);
    });
  }
}

function getSeriesColors(scheme, count) {
  const palettes = {
    blues: ['#42a5f5', '#1e88e5', '#1565c0', '#0d47a1', '#82b1ff'],
    greens: ['#66bb6a', '#43a047', '#2e7d32', '#1b5e20', '#a5d6a7'],
    reds: ['#ef5350', '#e53935', '#c62828', '#b71c1c', '#ef9a9a'],
    oranges: ['#ffa726', '#fb8c00', '#ef6c00', '#e65100', '#ffcc80'],
    purples: ['#ab47bc', '#8e24aa', '#6a1b9a', '#4a148c', '#ce93d8'],
    viridis: ['#440154', '#31688e', '#35b779', '#fde725', '#21918c'],
  };
  const pal = palettes[scheme] || palettes.blues;
  if (count <= pal.length) return pal.slice(0, count);
  return d3.quantize(d3.interpolateRainbow, count);
}
