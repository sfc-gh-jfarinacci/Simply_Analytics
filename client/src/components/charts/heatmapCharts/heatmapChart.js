import * as d3 from 'd3';

export function createHeatmapChart(container, data, {
  width, height, xField, yField, valueField,
  colorScheme = 'blues', animate = true, formatValue, showLabels = false,
}) {
  const isTiny = width < 160 || height < 120;
  const isCompact = width < 250 || height < 180;
  let margin = { top: 30, right: 20, bottom: 60, left: 80 };
  if (isTiny) {
    margin = { top: 4, right: 4, bottom: 20, left: 25 };
  } else if (isCompact) {
    margin = { top: 10, right: 10, bottom: 30, left: 40 };
  }
  let showCellLabels = showLabels;
  if (isTiny) showCellLabels = false;
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  if (innerW <= 0 || innerH <= 0 || !data.length) return;

  const svg = d3.select(container)
    .selectAll('svg').data([null]).join('svg')
    .attr('width', width).attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);

  const g = svg.selectAll('g.heatmap-root').data([null]).join('g')
    .attr('class', 'heatmap-root')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const xVals = [...new Set(data.map(d => d[xField]))];
  const yVals = [...new Set(data.map(d => d[yField]))];

  const valMap = new Map();
  data.forEach(d => valMap.set(`${d[xField]}|||${d[yField]}`, +d[valueField] || 0));

  const values = [...valMap.values()];
  const [minVal, maxVal] = d3.extent(values);

  const x = d3.scaleBand().domain(xVals).range([0, innerW]).padding(0.05);
  const y = d3.scaleBand().domain(yVals).range([0, innerH]).padding(0.05);

  const interpolator = getInterpolator(colorScheme);
  const color = (minVal !== maxVal)
    ? d3.scaleSequential(interpolator).domain([minVal, maxVal])
    : () => interpolator(0.5);

  const tooltip = d3.select(container).selectAll('.heatmap-tooltip').data([null]).join('div')
    .attr('class', 'heatmap-tooltip')
    .style('position', 'absolute').style('pointer-events', 'none').style('opacity', 0)
    .style('background', 'rgba(20,20,30,0.95)').style('color', '#e0e0e0')
    .style('padding', '6px 10px').style('border-radius', '6px')
    .style('font-size', '12px').style('box-shadow', '0 2px 8px rgba(0,0,0,0.4)')
    .style('z-index', '100').style('white-space', 'nowrap');

  const cellData = [];
  xVals.forEach(xv => {
    yVals.forEach(yv => {
      cellData.push({ x: xv, y: yv, value: valMap.get(`${xv}|||${yv}`) ?? null });
    });
  });

  g.selectAll('rect.cell')
    .data(cellData, d => `${d.x}|||${d.y}`)
    .join(
      enter => enter.append('rect').attr('class', 'cell')
        .attr('x', d => x(d.x)).attr('y', d => y(d.y))
        .attr('width', x.bandwidth()).attr('height', y.bandwidth())
        .attr('rx', 2)
        .attr('fill', d => d.value != null ? color(d.value) : '#1a1a24')
        .style('opacity', animate ? 0 : 1)
        .call(s => animate && s.transition().duration(500).delay((_, i) => i * 2).style('opacity', 1)),
      update => update.transition().duration(400)
        .attr('x', d => x(d.x)).attr('y', d => y(d.y))
        .attr('width', x.bandwidth()).attr('height', y.bandwidth())
        .attr('fill', d => d.value != null ? color(d.value) : '#1a1a24'),
      exit => exit.remove()
    )
    .style('cursor', 'pointer')
    .on('mouseenter', function(event, d) {
      d3.select(this).attr('stroke', '#fff').attr('stroke-width', 2);
      const fmt = formatValue || d3.format(',.1f');
      tooltip.html(`<strong>${xField}:</strong> ${d.x}<br/><strong>${yField}:</strong> ${d.y}<br/><strong>${valueField}:</strong> ${d.value != null ? fmt(d.value) : '—'}`)
        .style('opacity', 1);
    })
    .on('mousemove', function(event) {
      const rect = container.getBoundingClientRect();
      tooltip.style('left', `${event.clientX - rect.left + 12}px`).style('top', `${event.clientY - rect.top - 10}px`);
    })
    .on('mouseleave', function() {
      d3.select(this).attr('stroke', null);
      tooltip.style('opacity', 0);
    });

  if (showCellLabels && x.bandwidth() > 28 && y.bandwidth() > 16) {
    const fmt = formatValue || d3.format(',.0f');
    g.selectAll('text.cell-label')
      .data(cellData.filter(d => d.value != null), d => `${d.x}|||${d.y}`)
      .join('text')
      .attr('class', 'cell-label')
      .attr('x', d => x(d.x) + x.bandwidth() / 2)
      .attr('y', d => y(d.y) + y.bandwidth() / 2)
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .attr('fill', d => {
        const v = (d.value - minVal) / (maxVal - minVal || 1);
        return v > 0.6 ? '#fff' : '#222';
      })
      .attr('font-size', Math.min(11, y.bandwidth() * 0.6))
      .text(d => fmt(d.value));
  }

  const xAxisG = g.selectAll('g.x-axis').data([null]).join('g').attr('class', 'x-axis')
    .attr('transform', `translate(0,${innerH})`);
  xAxisG.call(d3.axisBottom(x).tickSize(0))
    .selectAll('text').attr('fill', '#888').attr('font-size', 10)
    .attr('transform', xVals.length > 10 ? 'rotate(-45)' : null)
    .style('text-anchor', xVals.length > 10 ? 'end' : 'middle')
    .style('opacity', isTiny ? 0 : 1);
  xAxisG.select('.domain').remove();

  const yAxisG = g.selectAll('g.y-axis').data([null]).join('g').attr('class', 'y-axis');
  yAxisG.call(d3.axisLeft(y).tickSize(0))
    .selectAll('text').attr('fill', '#888').attr('font-size', 10)
    .style('opacity', isTiny ? 0 : 1);
  yAxisG.select('.domain').remove();
}

function getInterpolator(scheme) {
  const m = {
    blues: d3.interpolateBlues, greens: d3.interpolateGreens, reds: d3.interpolateReds,
    oranges: d3.interpolateOranges, purples: d3.interpolatePurples,
    viridis: d3.interpolateViridis, plasma: d3.interpolatePlasma,
    inferno: d3.interpolateInferno, turbo: d3.interpolateTurbo,
    ylgnbu: d3.interpolateYlGnBu, ylorbr: d3.interpolateYlOrBr,
  };
  return m[scheme] || m.blues;
}
