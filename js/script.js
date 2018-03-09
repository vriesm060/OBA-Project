
(function () {

	var app = {
		init: function () {
			loader.show();
			api.getStreets();
			map.init();
		}
	};

	var sparqlQueries = {
		streetsQuery: function () {
			return `
				PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
				PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
				PREFIX hg: <http://rdf.histograph.io/>
				PREFIX geo: <http://www.opengis.net/ont/geosparql#>
				PREFIX geof: <http://www.opengis.net/def/function/geosparql/>

				SELECT ?street ?name ?wkt WHERE {
				  ?street a hg:Street .
				  ?street rdfs:label ?name .
				  ?street geo:hasGeometry ?geo .
				  ?geo geo:asWKT ?wkt .
				}
			`;
		},
		streetDetailsQuery: function (link) {
			return `
				PREFIX dct: <http://purl.org/dc/terms/>
				PREFIX foaf: <http://xmlns.com/foaf/0.1/>
				PREFIX dc: <http://purl.org/dc/elements/1.1/>
				PREFIX sem: <http://semanticweb.cs.vu.nl/2009/11/sem/>

				SELECT ?item ?img YEAR(?date) WHERE {
				  ?item dct:spatial <${link}> .
				  ?item foaf:depiction ?img .
				  ?item dc:type "foto"^^xsd:string.
				  ?item sem:hasBeginTimeStamp ?date .
				}
				ORDER BY ?date
			`;
		}
	};

	var api = {
		encodedquery: function (query) { return encodeURIComponent(query); },
		queryurl: function (query) {
			return `
				https://api.data.adamlink.nl/datasets/AdamNet/all/services/endpoint/sparql?default-graph-uri=&query=
				${this.encodedquery(query)}
				&format=application%2Fsparql-results%2Bjson&timeout=0&debug=on
			`;
		},
		getStreets: async function () {
			await fetch(this.queryurl(sparqlQueries.streetsQuery()))
				.then((res) => res.json())
			  	.then(function (data) {
					
					var rows = data.results.bindings;

					var streets = rows.map(function (item) {
						return {
							'type': 'Feature',
							'properties': {
								'streetName': item.name.value,
								'link': item.street.value
							},
							'geometry': wellknown(item.wkt.value)
						};
					});

					loader.hide();
					search.searchbar.show();
					search.init(streets);
					map.renderStreets(streets);

				})
				.catch(function (error) {
					// if there is any error you will catch them here
					console.log(error);
				});
		},
		getStreetDetails: async function (link) {
			await fetch(this.queryurl(sparqlQueries.streetDetailsQuery(link)))
				.then((res) => res.json())
					.then(function (data) {

						var rows = data.results.bindings;

						// Map all the years from the data:
						// Result: [year1, year2, etc]
						var allYears = rows.map(function (item) {
							return item['callret-2'].value;
						});

						// Get rid of all the duplicate years:
						var noDuplicates = allYears.filter(function (year, i, self) {
							if (self.indexOf(year) == i) {
								return year;
							}
						});

						// Map the unique years into a new object, with room for the images:
						var years = noDuplicates.map(function (item) {
							return {
								'year': item,
								'images': []
							};
						});

						// Add all the images that corresponds with the given year:
						rows.forEach(function (item) {
							var idx = years.map(function (obj) {
								return obj.year;
							}).indexOf(item['callret-2'].value);

							years[idx].images.push(item.img);
						});

						timeline.addCurrentYears(years);

					})
					.catch(function (error) {
						// if there is any error you will catch them here
						console.log(error);
					});
		}
	};

	var map = {
		mapboxAccessToken: 'pk.eyJ1IjoibWF4ZGV2cmllczk1IiwiYSI6ImNqZWZydWkyNjF3NXoyd28zcXFqdDJvbjEifQ.Dl3DvuFEqHVAxfajg0ESWg',
		map: L.map('map', {
			zoomControl: false
		}),
		init: function () {
			// Set the original view of the map:
			this.map.setView([52.370216, 4.895168], 13);

			L.tileLayer('https://api.mapbox.com/styles/v1/maxdevries95/cjefrwpkc4w0a2sn7e6lroutx/tiles/256/{z}/{x}/{y}?access_token=' + this.mapboxAccessToken, {
				maxZoom: 20,
				attribution: 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors, <a href="http://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, Imagery © <a href="http://mapbox.com">Mapbox</a>',
				id: 'mapbox.streets'
			}).addTo(this.map);

			L.control.zoom({
				position: 'topright'
			})
			.addTo(this.map);
		},
		renderStreets: function (data) {

			var geojsonMarkerOptions = {
				radius: 1
			};

			L.geoJSON(data, {
				pointToLayer: function (feature, latlng) { return L.circleMarker(latlng, geojsonMarkerOptions); }
			})
			.addTo(this.map)
			.on('mouseover', this.handleHoverOverStreet)
			.on('click', function (e) {
				event.handleClickOnStreet(e.layer.feature);
			});

		},
		setCurrentView: function (lat, lng) {
			this.map.setView([lat, lng], 16);
		},
		handleHoverOverStreet: function (e) {
			L.popup({
				closeButton: false
			})
				.setLatLng(e.latlng)
				.setContent(e.layer.feature.properties.streetName)
    		.openOn(map.map);
		}
	};

	var search = {
		searchbar: {
			el: document.querySelector('.search input'),
			show: function () {
				this.el.classList.add('show');
			}
		},
		searchResults: {
			el: document.querySelector('.results')
		},
		init: function (data) {
			var self = this;

			this.searchbar.el.addEventListener('input', function (e) {
				e.preventDefault();
				imagesContainer.container.hide();
				self.getSearchResults(data, this.value);
			}, false);
		},
		getSearchResults: function (data, value) {
			if (value.length > 1) {

				var results = data.filter(function (item) {
					// Check if item.properties.streetName starts with the input value:
					if (item.properties.streetName.toLowerCase().includes(value.toLowerCase())) {
						return item;
					}
				});

				this.setSearchResults(results);

			} else {
				this.searchResults.el.innerHTML = '';
			}
		},
		setSearchResults: function (results) {
			var self = this;
			this.searchResults.el.innerHTML = '';

			if (results.length === 0) {
				var li = document.createElement('LI');

				li.textContent = 'Geen resultaten gevonden.';

				this.searchResults.el.appendChild(li);
			} else {
				results.forEach(function (result, i) {
					if (i < 2) {
						var li = document.createElement('LI');
						var a = document.createElement('A');

						a.textContent = result.properties.streetName;
						a.href = result.properties.link;

						self.searchResults.el.appendChild(li);
						li.appendChild(a);

						a.addEventListener('click', function (e) {
							e.preventDefault();
							self.searchbar.el.value = '';
							self.searchResults.el.innerHTML = '';
							event.handleClickOnStreet(result);
						}, false);
					}
				});
			}
		}
	};

	// [!] Find better object name:
	var event = {
		handleClickOnStreet: function (street) {
			var latlng;

			if (street.geometry.type === 'Point') {
				latlng = street.geometry.coordinates;
			} else {
				latlng = street.geometry.coordinates[0][0];
			}

			map.setCurrentView(latlng[1], latlng[0]);
			api.getStreetDetails(street.properties.link);
			title.show();
			title.addStreetName(street.properties.streetName);
		}
	};

	var timeline = {
		el: document.querySelector('.timeline'),
		addCurrentYears: function (years) {
			var self = this;
			this.el.innerHTML = '';

			var yearsInBetween = Number(years[years.length - 1].year) - Number(years[0].year) + 1;
			var yearWidth = 100 / yearsInBetween;

			years.forEach(function (item, i) {
				var li = document.createElement('LI');
				var span = document.createElement('SPAN');

				li.style.width = 'calc(' + yearWidth + '% - 2px)';
				li.style.left = ((Number(item.year) - Number(years[0].year)) * yearWidth) + '%';

				span.textContent = item.year;
				
				self.el.appendChild(li);
				li.appendChild(span);

				li.addEventListener('click', function () {
					imagesContainer.container.show();
					imagesContainer.addImages(item);
				}, false);
			});
		}
	};

	var imagesContainer = {
		container: {
			el: document.querySelector('.images--container'),
			show: function () {
				this.el.classList.add('show');
			},
			hide: function () {
				this.el.classList.remove('show');
			}
		},
		imageList: {
			el: document.querySelector('.images--container ul'),
		},
		closeBtn: {
			el: document.querySelector('.close-btn')
		},
		addImages: function (year) {
			var self = this;
			this.imageList.el.innerHTML = '';

			year.images.forEach(function (image) {
				var li = document.createElement('LI');
				var img = document.createElement('IMG')

				img.src = image.value;

				self.imageList.el.appendChild(li);
				li.appendChild(img);
			});

			this.closeBtn.el.addEventListener('click', function () {
				self.container.hide();
			}, false);
		}
	};

	var title = {
		el: document.querySelector('#street-name'),
		show: function () {
			this.el.classList.add('show');
		},
		addStreetName: function (streetName) {
			this.el.textContent = streetName;
		}
	};

	var loader = {
		el: document.querySelector('#loader'),
		show: function () {
			this.el.classList.add('show');
		},
		hide: function () {
			this.el.classList.remove('show');
		}
	};

	app.init();

}) ();
