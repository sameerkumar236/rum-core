# Local world map data

`world-paths.json` contains real Natural Earth 1:110m country boundaries projected into a 1000 × 400 SVG using the Natural Earth projection. It has 176 shapes, with Antarctica omitted to keep the inhabited world readable. Path coordinates are rounded to two decimal places. Marker positions are derived from each feature's spherical geographic centroid; they are not user locations or city coordinates.

Source topology is preserved in `countries-110m.topo.json`, downloaded from [world-atlas 2.0.2](https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json). It is the same dataset referenced by the original RUM Core map. Natural Earth data is [public domain](https://www.naturalearthdata.com/about/terms-of-use/). The world-atlas redistribution license is in `world-atlas-LICENSE.txt`.

Country numeric IDs are mapped to two-letter territory codes using the preserved [Unicode CLDR code mappings](https://github.com/unicode-org/cldr-json/blob/main/cldr-json/cldr-core/supplemental/codeMappings.json), licensed under `unicode-LICENSE.txt`. Historical territory aliases and three-letter currency entries are excluded. Kosovo uses the customary `XK` code. The source's Northern Cyprus and Somaliland shapes have no separate ISO codes and retain their source names.

The SVG paths were generated once using `topojson-client.feature`, `d3.geoNaturalEarth1().fitExtent([[8, 8], [992, 392]], features)`, and `d3.geoPath`. Those libraries are not runtime dependencies. The component imports the prepared paths, so the map works without fetching external geography files.

This small-scale dataset does not contain every island or microstate. Unknown or unrepresented countries are reported as unmapped rather than assigned an invented location. Boundary rendering follows the source data and does not imply a position on disputed borders.
