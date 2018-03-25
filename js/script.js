
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

						var streetName = item.name.value;
						var link = item.street.value;
						var slug = link.slice((link.indexOf('street/') + 7), link.lastIndexOf('/'));
						var geo = item.wkt.value;

						return {
							'type': 'Feature',
							'properties': {
								'streetName': streetName,
								'slug': slug,
								'link': link
							},
							'geometry': wellknown(geo)
						};
					});

					loader.hide();
					map.renderStreets(streets);
					options.main.show();
					options.search.init(streets);

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

						options.timeline.addCurrentYears(years);

					})
					.catch(function (error) {
						// if there is any error you will catch them here
						console.log(error);
					});
		}
	};

	var events = {
		handleClickOnStreet: function (street) {

			var latlng;

			if (street.geometry.type === 'Point') {
				latlng = street.geometry.coordinates;
			} else {
				latlng = street.geometry.coordinates[0][0];
			}

			api.getStreetDetails(street.properties.link);
			map.setCurrentView(latlng[1], latlng[0]);
			map.highlightStreet(street.properties.slug);
			options.title.addStreetName(street.properties.streetName);
			options.timeline.container.show();
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

			L.tileLayer('https://api.mapbox.com/styles/v1/maxdevries95/cjesmtkaj8iqs2rmoe0bo17w7/tiles/256/{z}/{x}/{y}?access_token=' + this.mapboxAccessToken, {
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
				style: function (feature) {
					return {
						weight: 1,
						lineCap: 'square',
						lineJoin: 'square',
						className: feature.properties.slug
					}
				},
				pointToLayer: function (feature, latlng) { return L.circleMarker(latlng, geojsonMarkerOptions); }
			})
			.addTo(this.map)
			.on('mouseover', this.handleHoverOverStreet)
			.on('click', function (e) {
				events.handleClickOnStreet(e.layer.feature);
			});

		},
		setCurrentView: function (lat, lng) {
			this.map.setView([lat, lng], 17);
		},
		handleHoverOverStreet: function (e) {
			var point = L.point(0, -5);

			L.popup({
				closeButton: false,
				offset: point
			})
				.setLatLng(e.latlng)
				.setContent(e.layer.feature.properties.streetName)
    		.openOn(map.map);
		},
		highlightStreet: function (slug) {
			var path = document.querySelectorAll('path');

			path.forEach(function (item) {
				if (item.classList.contains('active')) item.classList.remove('active');
				if (item.classList.contains(slug)) item.classList.add('active');
			});
		}
	};

	var options = {
		main: {
			el: document.querySelector('.options'),
			show: function () {
				this.el.classList.add('show');
			}
		},
		title: {
			el: document.querySelector('#street-name'),
			addStreetName: function (streetName) {
				this.el.textContent = streetName;
			}
		},
		search: {
			searchbar: {
				el: document.querySelector('input[name="searchbar"]')
			},
			currentFocus: 0,
			init: function (data) {
				var self = this;

				// Event listener for input value:
				this.searchbar.el.addEventListener('input', function (e) {
					self.closeAllLists();
					if (!this.value) return false;
					self.currentFocus = -1;
					options.imagesContainer.container.hide();
					self.getAutocomplete(data, this.value);
				}, false);

				// Event listener for pressing up or down key:
				this.searchbar.el.addEventListener('keydown', function (e) {

					var x = document.getElementById(this.id + 'autocomplete-list');

					if (x) x = x.querySelectorAll('li');

					if (e.keyCode == 40) {
						self.currentFocus++;
						self.addActive(x);
					} else if (e.keyCode == 38) {
						self.currentFocus--;
						self.addActive(x);
					} else if (e.keyCode == 13) {
						e.preventDefault();
						if (self.currentFocus > -1) {
							if (x) x[self.currentFocus].children[0].click();
						}
					}

				}, false);

				// Event listener when clicking the document:
				document.addEventListener('click', function (e) {
					self.closeAllLists(e.target);
				}, false);
			},
			getAutocomplete: function (data, val) {

				var results = data.filter(function (street) {
					if (street.properties.streetName.substr(0, val.length).toUpperCase() == val.toUpperCase()) {
						return street;
					}
				});

				this.setAutocomplete(results);

			},
			setAutocomplete: function (results) {
				var self = this;

				var ul = document.createElement('UL');

				ul.setAttribute('id', this.searchbar.el.id + 'autocomplete-list');
				ul.setAttribute('class', 'autocomplete-items');

				this.searchbar.el.parentNode.appendChild(ul);

				results.forEach(function (result, i) {
					if (i < 2) {
						
						var li = document.createElement('LI');
						var a = document.createElement('A');

						li.appendChild(a);

						a.textContent = result.properties.streetName;
						a.href = result.properties.link;

						a.addEventListener('click', function (e) {
							
							e.preventDefault();

							self.searchbar.el.value = this.textContent;

							self.closeAllLists();
							events.handleClickOnStreet(result);

						}, false);

						ul.appendChild(li);

					}
				});

			},
			addActive: function (x) {

				if (!x) return false;

				this.removeActive(x);

				if (this.currentFocus >= x.length) this.currentFocus = 0;
				if (this.currentFocus < 0) this.currentFocus = (x.length - 1);

				x[this.currentFocus].children[0].classList.add('autocomplete-active');

			},
			removeActive: function (x) {
				
				for (var i = 0; i < x.length; i++) {
					x[i].children[0].classList.remove('autocomplete-active');
				}

			},
			closeAllLists: function (el) {

				var x = document.querySelectorAll('.autocomplete-items');

				for (var i = 0; i < x.length; i++) {
					
					if (el != x[i] && el != this.searchbar.el) {
						x[i].parentNode.removeChild(x[i]);
					}

				}

			}
		},
		timeline: {
			container: {
				el: document.querySelector('.timeline--container'),
				show: function () {
					this.el.classList.add('show');
				}
			},
			timeline: {
				el: document.querySelector('.timeline')
			},
			addCurrentYears: function (years) {
				var self = this;

				this.timeline.el.innerHTML = '';

				var yearsInBetween = Number(years[years.length - 1].year) - Number(years[0].year) + 1;
				var yearWidth = 100 / yearsInBetween;

				years.forEach(function (item, i) {
					var li = document.createElement('LI');
					var a = document.createElement('A');
					var span = document.createElement('SPAN');

					li.style.left = ((Number(item.year) - Number(years[0].year)) * yearWidth) + '%';

					a.href = '#';

					span.textContent = item.year;
					
					self.timeline.el.appendChild(li);
					li.appendChild(a);
					a.appendChild(span);

					a.addEventListener('click', function (e) {
						e.preventDefault();
						options.imagesContainer.container.show();
						options.imagesContainer.addImages(item);
					}, false);
				});
			}
		},
		imagesContainer: {
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
