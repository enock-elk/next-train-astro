/**
 * Interactive Leaflet map (ported from SPA map.html)
 * Expects window.ROUTES, window.DYNAMIC_BASE_URL, window.PIPELINE_SOURCES, window.REGIONS
 */
        // 🛡️ GUARDIAN PHASE 3: RESTORED STATION COORDINATES DICTIONARY
        const STATION_COORDINATES = {
            // --- GAUTENG ---
            "PRETORIA": [-25.75864361043285, 28.189866445989118],
            "CAPITAL PARK": [-25.71861021137544, 28.199638809110184],
            "GEZINA": [-25.72149393871516, 28.205461660683653],
            "DEERNESS": [-25.720427758066748, 28.215590710959766],
            "VILLIERIA": [-25.71978884760139, 28.228856837877064],
            "PIERNEEFSRUS": [-25.719666309748767, 28.239301131411885],
            "QUEENSWOOD": [-25.721853760563217, 28.25178790666072],
            "MEARS STREET": [-25.759836388884576, 28.201559350093763],
            "DEVENISH STREET": [-25.760571651064055, 28.209966455924803],
            "WALKER STREET": [-25.76012800529803, 28.213499980098053],
            "LOFTUS VERSFELD PARK": [-25.754940155678536, 28.22535667426071],
            "RISSIK": [-25.749263370927064, 28.232274866782785],
            "HARTBEESSPRUIT": [-25.746016335334863, 28.24495952932333],
            "KOEDOESPOORT": [-25.72608149772232, 28.27872645216183], 
            "SILVERTON": [-25.727388634278455, 28.29699912151972],
            "WALTLOO": [-25.716964535181983, 28.32134413848142],
            "DENNEBOOM": [-25.719077472725353, 28.336637070658863],
            "EERSTE FABRIEKE": [-25.7221815801619, 28.359894081240192],
            "MAMELODI GARDENS": [-25.727137148700365, 28.38522516947939],
            "GREENVIEW": [-25.73018814715231, 28.40503024599571],
            "PIENAARSPOORT": [-25.734672061252613, 28.426968817228143],
            "PRETORIA-B": [-25.756676856613193, 28.185038595618654],
            "PRETORIA WES": [-25.75612607001734, 28.167454033423436],
            "HERCULES": [-25.724426332570793, 28.16740145328856],
            "DASPOORT": [-25.71389154994833, 28.16610216678128],
            "MOUNTAIN VIEW": [-25.701154966265122, 28.1710407244521],
            "WONDERBOOM": [-25.679398283013505, 28.182541636641577],
            "PRETORIA-N": [-25.672156912459837, 28.181972182122085],
            "WOLMERTON": [-25.656754583256834, 28.166308537943245],
            "WINTERSNEST": [-25.646665143468105, 28.128664081235527],
            "AKASIABOOM": [-25.62343788217021, 28.107351095613126],
            "KOPANONG": [-25.581315356478292, 28.0903223133063],
            "SOSHANGUVE": [-25.520916877100483, 28.082831418476943],
            "MABOPANE": [-25.495963167301053, 28.089659387779985],
            "ROSSLYN": [-25.637700722357806, 28.094920182723996],
            "GA-RANKUWA": [-25.619463521827942, 27.991787773598496],
            "TAILLARDSHOOP": [-25.617806769500547, 27.972401220150644],
            "DE WILDT": [-25.624641315648187, 27.944111334913465],
            "MITCHELLSTRAAT": [-25.75622307580123, 28.162751428886452],
            "SCHUTTESTRAAT": [-25.75017407001962, 28.139987824474776],
            "KALAFONG": [-25.760158250653994, 28.088193742988445],
            "ATTERIDGEVILLE": [-25.76284784698717, 28.07501926678321],
            "SAULSVILLE": [-25.76414387754825, 28.06212905285695],
            "FONTEINE": [-25.783934589307606, 28.193278224251035],
            "KLOOFSIG": [-25.81354583485274, 28.201211703182715],
            "SPORTPARK": [-25.82467276464524, 28.20570286536511],
            "CENTURION": [-25.83486600288455, 28.210815277978245],
            "IRENE": [-25.875543329741795, 28.22408282846379],
            "PINEDENE": [-25.925032822473873, 28.22802340576307],
            "OLIFANTSFONTEIN": [-25.964142125962706, 28.2355174075199],
            "OAKMOOR": [-26.00579639391282, 28.248566233475742],
            "KAALFONTEIN": [-26.03555593578171, 28.25416120912308],
            "BIRCHLEIGH": [-26.066977064619714, 28.234569695631336],
            "VAN RIEBEECKPARK": [-26.08799580477522, 28.221739995632177],
            "KEMPTON PARK": [-26.10627314041378, 28.22733384351009],
            "RHODESFIELD": [-26.126491398917288, 28.22477839248156],
            "ISANDO": [-26.135629334887778, 28.221811980118165],
            "ELANDSFONTEIN": [-26.16670702075184, 28.20530291097802],
            "RAVENSKLIP": [-26.180916686844835, 28.19981212632109],
            "KNIGHTS": [-26.19566598383361, 28.196166697507],
            "GERMISTON": [-26.209629310943757, 28.16775038029468],
            "TEMBISA": [-26.009687133196852, 28.231477162611803],
            "LIMINDLELA": [-26.011188907434516, 28.214689000778122],
            "LERALLA": [-26.02917658612082, 28.196411826993103],
            "ELSBURG": [-26.242074536681013, 28.193485066234086],
            "KATLEHONG": [-26.307539143135436, 28.161448064536795],
            "LINDELA": [-26.326156380004434, 28.158191665672334],
            "PILOT": [-26.340713981819974, 28.152496274644147],
            "KWESINE": [-26.365394305815887, 28.152781379926747],
            "PRESIDENT": [-26.211589161672503, 28.159915894140354],
            "DRIEHOEK": [-26.21349039399697, 28.14960493666655],
            "GELDENHUIS": [-26.20778570409101, 28.132917922623346],
            "CLEVELAND": [-26.20833436358959, 28.11835882447283],
            "TOORONGA": [-26.203940084237757, 28.110387300000003],
            "DENVER": [-26.20565353546564, 28.09711574417819],
            "GEORGE GOCH": [-26.207362180909303, 28.08040019563714],
            "JEPPE": [-26.203925808444886, 28.06346159144729],
            "ELLIS PARK": [-26.198718312467125, 28.059031479241852],
            "DOORNFONTEIN": [-26.19692478075003, 28.054170880294237],
            "JOHANNESBURG": [-26.197647593316965, 28.04233618836466],
            "BRAAMFONTEIN": [-26.19785038795819, 28.022075850924722],
            "MAYFAIR": [-26.204357573800028, 28.014409877846887],
            "GROSVENOR": [-26.202962977069127, 28.00593136680137],
            "LANGLAAGTE": [-26.201719229862785, 27.990539266801267],
            // SPA map-data.js GP stations still referenced by route polylines
            "CROESUS": [-26.201595050664512, 27.97172133796557],
            "MLAMLANKUNZI": [-26.22594835366509, 27.928217035582186],
            "ORLANDO": [-26.237577526260885, 27.91727947272508],
            "NANCEFIELD": [-26.25168123666912, 27.906423465881122],
            "KLIPTOWN": [-26.272809958189928, 27.887633494308975],
            "TSHIAWELO": [-26.288947777153577, 27.87068768853021],
            "MIDWAY": [-26.292695060119772, 27.851230923913732],
            "MARAISBURG": [-26.179451103586576, 27.939930801976423],
            "UNIFIED": [-26.17934640087511, 27.926554891892838],
            "FLORIDA": [-26.176752716611063, 27.91426358618772],
            "HAMBERG": [-26.16761329423407, 27.89363955466481],
            "GEORGINIA": [-26.164695347837018, 27.87995514003489],
            "ROODEPOORT": [-26.159057627819767, 27.869960853694568],
            "HORISON": [-26.146612509666905, 27.86374942964767],
            "PRINCESS": [-26.132583466401883, 27.853421824034942],
            "WITPOORTJIE": [-26.126711162132259, 27.830401030605525],
            "LUIPAARDSVLEI": [-26.11163273453303, 27.808953046777626],
            "KRUGERSDORP": [-26.108673106302327, 27.77054582194475],
            "WESRAND": [-26.111842932573754, 27.748279009896308],
            "MILLSITE": [-26.128472634725075, 27.738984350810526],
            "ROBINSON": [-26.15772328478757, 27.715139426035496],
            "HOMELAKE": [-26.16792472543254, 27.707411915946505],
            "RANDFONTEIN": [-26.18172322656187, 27.69778245070208],
            "NEW CANADA": [-26.214411850342184, 27.94240072447306],
            "LONGDALE": [-26.198503123750555, 27.962929509129903],
            "MZIMHLOPE": [-26.223861505533936, 27.921532143394266],
            "PHOMOLONG": [-26.226703184419414, 27.90867427408623],
            "PHEFENI": [-26.235333111848036, 27.90499985809428],
            "DUBE": [-26.232994816765324, 27.89235589471589],
            "IKWEZI": [-26.23066586388434, 27.87708944718947],
            "INHLAZANE": [-26.249713244610206, 27.863467738215245],
            "MERAFE": [-26.26213048623854, 27.84657941488496],
            "NALEDI": [-26.257998333942396, 27.822761926970013],
            "BELLE-OMBRE": [-25.73740468957095, 28.178914335051033],
            
            // --- WESTERN CAPE ---
            "BELLVILLE": [-33.906263, 18.626621],
            "SAREPTA": [-33.926555, 18.661143],
            "PENTECH": [-33.934680, 18.646053],
            "UNIBELL": [-33.936863, 18.628117],
            "BELHAR": [-33.939597, 18.608944],
            "LAVISTOWN": [-33.943269, 18.583722],
            "CHRIS HANI": [-34.054706, 18.710707],
            "KUYASA": [-34.054899, 18.692323],
            "KHAYELITSHA": [-34.047943, 18.670737],
            "NONKQUBELA": [-34.026817, 18.663190],
            "NOLUNGILE": [-34.016811, 18.649023],
            "MANDALAY": [-34.019015, 18.624391],
            "STOCK ROAD": [-34.014122, 18.606174],
            "KAPTEINSKLIP": [-34.067558, 18.620534],
            "MITCHELL'S PLAIN": [-34.050461, 18.619222],
            "LENTEGEUR": [-34.034189, 18.611322],
            "PHILIPPI": [-34.013288, 18.584421],
            "NYANGA": [-33.992713, 18.559776],
            "BONTEHEUWEL": [-33.941850, 18.549579],
            "LANGA": [-33.938934, 18.529744],
            "MUTUAL": [-33.922093, 18.511988],
            "YSTERPLAAT": [-33.919902, 18.476775],
            "ESPLANADE": [-33.923640, 18.446037],
            "PINELANDS": [-33.939644, 18.490635],
            "NDABENI": [-33.928548, 18.495159],
            "MAITLAND": [-33.924651, 18.487001],
            "KOEBERG RD": [-33.925709, 18.478877],
            "SALT RIVER": [-33.927545, 18.464689],
            "WOODSTOCK": [-33.925058, 18.446139],
            "CAPE TOWN": [-33.923631, 18.427186],
            "NETREG": [-33.952666, 18.563566],
            "HEIDEVELD": [-33.969594, 18.561877],
            
            // GUARDIAN: Western Cape Expansion 
            "RETREAT": [-34.059732, 18.463112],
            "HEATHFIELD": [-34.045911, 18.465287],
            "SOUTHFIELD": [-34.032856, 18.481922],
            "OTTERY": [-34.016335, 18.497534],
            "WETTON": [-34.001981, 18.501121],
            "LANSDOWNE": [-33.987612, 18.503827],
            "CRAWFORD": [-33.976372, 18.501211],
            "ATHLONE": [-33.96328, 18.50085],
            "HAZENDAL": [-33.9555, 18.4996],
            "CENTURY CITY": [-33.901117, 18.511648],
            "MONTE VISTA": [-33.891667, 18.549616],
            "AVONDALE": [-33.897780, 18.592875],
            "OOSTERZEE": [-33.900001, 18.607403],
            "STIKLAND": [-33.8967, 18.6738],
            "BRACKENFELL": [-33.8797, 18.6946],
            "EIKENFONTEIN": [-33.8631, 18.7078],
            "KRAAIFONTEIN": [-33.844722, 18.715278],
            "FISANTKRAAL": [-33.7845, 18.7208],
            "MELLISH": [-33.762434, 18.717704],
            "MIKPUNT": [-33.723878, 18.707949],
            "KLIPHEUWEL": [-33.699155, 18.700347],
            "WINTERVOGEL": [-33.629563, 18.669953],
            "WINTEVOGEL": [-33.629563, 18.669953], 
            "KALBASKRAAL": [-33.572554, 18.647601],
            "ABBOTSDALE": [-33.492604, 18.681903],
            "MALMESBURY": [-33.467954, 18.722366],

            // --- KWAZULU-NATAL ---
            "DURBAN YARD": [-29.839174, 31.024453],
            "DURBAN": [-29.844818, 31.022411],
            "BEREA ROAD": [-29.857146, 31.012251],
            "DALBRIDGE": [-29.868007, 31.006317],
            "CONGELLA": [-29.877804, 30.996696],
            "UMBILO": [-29.890408, 30.984596],
            "ROSSBURGH": [-29.899434, 30.980499],
            "CLAIRWOOD": [-29.915127, 30.977414],
            "MONTCLAIR": [-29.911973, 30.974899],
            "MEREBANK": [-29.943867, 30.958701],
            "REUNION": [-29.963225, 30.941094],
            "ZWELETHU": [-29.963504, 30.916932],
            "KWAMNYANDU": [-29.972439, 30.904182],
            "LINDOKUHLE": [-29.959340, 30.888758],
            "UMLAZI": [-29.953969, 30.866029],
            
            // KZN Expansion (North, South, Inland, Pinetown)
            "BRIDGE CITY": [-29.726914, 30.986441],
            "KWAMASHU": [-29.750076, 30.973638],
            "TEMBALIHLE": [-29.742326, 30.993270],
            "DUFF'S ROAD": [-29.743381, 31.004387],
            "EFFINGHAM": [-29.758000, 31.010000], 
            "KENVILLE": [-29.792234, 31.001315],
            "TEMPLE": [-29.803794, 31.005942],
            "AVOCA": [-29.760772, 31.021557],
            "RED HILL": [-29.778811, 31.022787],
            "GREENWOOD PARK": [-29.788863, 31.019987],
            "BRIARDENE": [-29.796700, 31.014188],
            "UMGENI": [-29.816806, 31.027420],
            "MOSES MABHIDA": [-29.828174, 31.031642],
            "WINKLESPRUIT": [-30.098583, 30.856762],
            "WARNER BEACH": [-30.083787, 30.867315],
            "DOONSIDE": [-30.071303, 30.873493],
            "AMANZIMTOTI": [-30.056679, 30.883188], 
            "PAHLA": [-30.041351, 30.889134],
            "UMBOGINTWINI": [-30.022514, 30.907357],
            "ISIPINGO": [-29.984081, 30.928631],
            "PELGRIM": [-29.974124, 30.933854],
            "CATO RIDGE": [-29.731996, 30.587660],
            "GEORGEDALE": [-29.780363, 30.612546],
            "KWATANDAZA": [-29.795700, 30.621560],
            "HAMMARSDALE": [-29.801105, 30.657429],
            "CLIFFDALE": [-29.791431, 30.681116],
            "NSHONGWENI": [-29.834422, 30.702781],
            "DELVILLE WOOD": [-29.839382, 30.712141],
            "KWANDENGEZI": [-29.834233, 30.736058],
            "DASSENHOEK": [-29.838564, 30.775784],
            "SITUNDU HILLS": [-29.854448, 30.790564],
            "THORNWOOD": [-29.856675, 30.790838],
            "MARIANNHILL": [-29.862478, 30.808716],
            "KLAARWATER": [-29.862151, 30.859345],
            "SHALLCROSS": [-29.890318, 30.899151],
            "BURLINGTON": [-29.890280, 30.899155],
            "CAVENDISH": [-29.896439, 30.913067],
            "MOUNT VERNON": [-29.900977, 30.933294],
            "PINETOWN": [-29.817914, 30.857940],
            "SARNIA": [-29.830424, 30.876694],
            "GLEN PARK": [-29.842851, 30.879913],
            "MOSELEY": [-29.850893, 30.883451],
            "NORTHDENE": [-29.863632, 30.885899],
            "ESCOMBE": [-29.873108, 30.900871],
            "MALVERN": [-29.879555, 30.919593],
            "POET'S CORNER": [-29.879624, 30.931123], 
            "BELLAIR": [-29.888762, 30.941657], 
            "SEA VIEW": [-29.902065, 30.961951],
            "HAVENSIDE": [-29.926302426956735, 30.937562200751156],
            "BAYVIEW": [-29.915492485588356, 30.918491645667224],
            "WESTCLIFF": [-29.90911584089301, 30.902484294984493],
            "CHATSGLEN": [-29.90702562701478, 30.88513415841232],
            "CROSSMOOR": [-29.898514072933363, 30.861925638560148],

            // --- EASTERN CAPE ---
            "EAST LONDON": [-33.016726, 27.907383],
            "SOUTHERNWOOD": [-33.009440, 27.903611],
            "PANMURE": [-32.998249, 27.890089],
            "CHISELHURST": [-32.986610, 27.894308],
            "VINCENT": [-32.978699, 27.898983],
            "CAMBRIDGE": [-32.972495, 27.891111],
            "HIGHGATE": [-32.971087, 27.876836],
            "HORSESHOE": [-32.966563, 27.841427],
            "DAWN": [-32.964754, 27.833460],
            "WILSONIA": [-32.966970, 27.821683],
            "ARNOLDTON": [-32.964989, 27.803070],
            "MTSOTSO": [-32.947780, 27.786397],
            "MDANTSANE": [-32.930547, 27.784716],
            "MOUNT RUTH": [-32.922115, 27.758430],
            "EGERTON": [-32.920332, 27.725769],
            "FORT JACKSON": [-32.920712, 27.699508],
            "LONETREE": [-32.898053, 27.643079],
            "BERLIN": [-32.881959, 27.583001]
        };

        // 🛡️ GUARDIAN PHASE 3: STATIC PATH DEFINITIONS
        // Bypasses empty or missing DB coordinate columns to draw lines flawlessly offline
        const STATIC_ROUTE_PATHS = {
            'pta-pien': ["PRETORIA", "MEARS STREET", "DEVENISH STREET", "WALKER STREET", "LOFTUS VERSFELD PARK", "RISSIK", "HARTBEESSPRUIT", "KOEDOESPOORT", "SILVERTON", "WALTLOO", "DENNEBOOM", "EERSTE FABRIEKE", "MAMELODI GARDENS", "GREENVIEW", "PIENAARSPOORT"],
            'pta-mabopane': ["PRETORIA", "PRETORIA-B", "PRETORIA WES", "HERCULES", "DASPOORT", "MOUNTAIN VIEW", "WONDERBOOM", "PRETORIA-N", "WOLMERTON", "WINTERSNEST", "AKASIABOOM", "KOPANONG", "SOSHANGUVE", "MABOPANE"],
            'mab-belle': ["MABOPANE", "SOSHANGUVE", "KOPANONG", "AKASIABOOM", "WINTERSNEST", "WOLMERTON", "PRETORIA-N", "WONDERBOOM", "MOUNTAIN VIEW", "DASPOORT", "HERCULES", "BELLE-OMBRE"],
            'pta-dewildt': ["WINTERSNEST", "ROSSLYN", "GA-RANKUWA", "TAILLARDSHOOP", "DE WILDT"],
            'herc-koed': ["HERCULES", "DASPOORT", "CAPITAL PARK", "GEZINA", "DEERNESS", "VILLIERIA", "PIERNEEFSRUS", "QUEENSWOOD", "KOEDOESPOORT"],
            'pta-saul': ["PRETORIA", "PRETORIA WES", "MITCHELLSTRAAT", "SCHUTTESTRAAT", "KALAFONG", "ATTERIDGEVILLE", "SAULSVILLE"],
            'pta-kempton': ["PRETORIA", "FONTEINE", "KLOOFSIG", "SPORTPARK", "CENTURION", "IRENE", "PINEDENE", "OLIFANTSFONTEIN", "OAKMOOR", "KAALFONTEIN", "BIRCHLEIGH", "VAN RIEBEECKPARK", "KEMPTON PARK"],
            // Pretoria ↔ Irene (subset of Kempton corridor) — needed for OSM track bake + map draw
            'pta-irene': ["PRETORIA", "FONTEINE", "KLOOFSIG", "SPORTPARK", "CENTURION", "IRENE"],
            'germ-leralla': ["GERMISTON", "KNIGHTS", "RAVENSKLIP", "ELANDSFONTEIN", "ISANDO", "RHODESFIELD", "KEMPTON PARK", "VAN RIEBEECKPARK", "BIRCHLEIGH", "KAALFONTEIN", "TEMBISA", "LIMINDLELA", "LERALLA"],
            'germ-kwesine': ["GERMISTON", "ELSBURG", "KATLEHONG", "LINDELA", "PILOT", "KWESINE"],
            'jhb-germiston': ["JOHANNESBURG", "DOORNFONTEIN", "ELLIS PARK", "JEPPE", "GEORGE GOCH", "DENVER", "TOORONGA", "CLEVELAND", "GELDENHUIS", "DRIEHOEK", "PRESIDENT", "GERMISTON"],
            'jhb-rand': ["JOHANNESBURG", "BRAAMFONTEIN", "MAYFAIR", "GROSVENOR", "LANGLAAGTE", "MARAISBURG", "UNIFIED", "FLORIDA", "HAMBERG", "GEORGINIA", "ROODEPOORT", "HORISON", "PRINCESS", "WITPOORTJIE", "LUIPAARDSVLEI", "KRUGERSDORP", "WESRAND", "MILLSITE", "ROBINSON", "HOMELAKE", "RANDFONTEIN"],
            'jhb-soweto': ["LANGLAAGTE", "LONGDALE", "NEW CANADA", "MZIMHLOPE", "PHOMOLONG", "PHEFENI", "DUBE", "IKWEZI", "INHLAZANE", "MERAFE", "NALEDI"],
            'jhb-midway': ["JOHANNESBURG", "BRAAMFONTEIN", "MAYFAIR", "GROSVENOR", "LANGLAAGTE", "CROESUS", "LONGDALE", "NEW CANADA", "MLAMLANKUNZI", "ORLANDO", "NANCEFIELD", "KLIPTOWN", "TSHIAWELO", "MIDWAY"],
            
            // --- WESTERN CAPE (GUARDIAN CORRECTED PATHS) ---
            // Mainline: Cape Town → Koeberg Rd → Maitland → Mutual, then split.
            'ct-chrishani': ["CAPE TOWN", "WOODSTOCK", "SALT RIVER", "KOEBERG RD", "MAITLAND", "MUTUAL", "LANGA", "BONTEHEUWEL", "NETREG", "HEIDEVELD", "NYANGA", "PHILIPPI", "STOCK ROAD", "MANDALAY", "NOLUNGILE", "NONKQUBELA", "KHAYELITSHA", "KUYASA", "CHRIS HANI"],
            'ct-kapteinsklip': ["CAPE TOWN", "WOODSTOCK", "SALT RIVER", "KOEBERG RD", "MAITLAND", "MUTUAL", "LANGA", "BONTEHEUWEL", "NETREG", "HEIDEVELD", "NYANGA", "PHILIPPI", "LENTEGEUR", "MITCHELL'S PLAIN", "KAPTEINSKLIP"],
            'bellville-mutual': ["BELLVILLE", "SAREPTA", "PENTECH", "UNIBELL", "BELHAR", "LAVISTOWN", "BONTEHEUWEL", "LANGA", "MUTUAL", "MAITLAND"],
            'ct-bellv': ["CAPE TOWN", "WOODSTOCK", "SALT RIVER", "KOEBERG RD", "MAITLAND", "MUTUAL", "BELLVILLE"],
            
            // GUARDIAN: Western Cape Expansion Paths
            'ct-malm': ["CAPE TOWN", "ESPLANADE", "YSTERPLAAT", "CENTURY CITY", "MONTE VISTA", "AVONDALE", "OOSTERZEE", "BELLVILLE", "STIKLAND", "BRACKENFELL", "EIKENFONTEIN", "KRAAIFONTEIN", "FISANTKRAAL", "MELLISH", "MIKPUNT", "KLIPHEUWEL", "WINTEVOGEL", "KALBASKRAAL", "ABBOTSDALE", "MALMESBURY"],
            'ct-flats': ["CAPE TOWN", "WOODSTOCK", "SALT RIVER", "KOEBERG RD", "MAITLAND", "MUTUAL", "NDABENI", "PINELANDS", "HAZENDAL", "ATHLONE", "CRAWFORD", "LANSDOWNE", "WETTON", "OTTERY", "SOUTHFIELD", "HEATHFIELD", "RETREAT"],
            'ct-nolu': ["CAPE TOWN", "WOODSTOCK", "SALT RIVER", "KOEBERG RD", "MAITLAND", "MUTUAL", "LANGA", "BONTEHEUWEL", "NYANGA", "PHILIPPI", "LENTEGEUR", "MITCHELL'S PLAIN", "KAPTEINSKLIP", "STOCK ROAD", "MANDALAY", "NOLUNGILE"],

            // --- KWAZULU-NATAL ---
            'kzn-umlazi': ["DURBAN YARD", "DURBAN", "BEREA ROAD", "DALBRIDGE", "CONGELLA", "UMBILO", "ROSSBURGH", "CLAIRWOOD", "MONTCLAIR", "MEREBANK", "REUNION", "ZWELETHU", "KWAMNYANDU", "LINDOKUHLE", "UMLAZI"],
            'kzn-bridgecity': ["BEREA ROAD", "DURBAN", "MOSES MABHIDA", "UMGENI", "BRIARDENE", "GREENWOOD PARK", "RED HILL", "AVOCA", "TEMPLE", "KENVILLE", "EFFINGHAM", "DUFF'S ROAD", "TEMBALIHLE", "KWAMASHU", "BRIDGE CITY"],
            'kzn-winklespruit': ["DURBAN YARD", "DURBAN", "BEREA ROAD", "DALBRIDGE", "CONGELLA", "UMBILO", "ROSSBURGH", "CLAIRWOOD", "MONTCLAIR", "MEREBANK", "PELGRIM", "ISIPINGO", "UMBOGINTWINI", "PAHLA", "AMANZIMTOTI", "DOONSIDE", "WARNER BEACH", "WINKLESPRUIT"],
            'kzn-catoridge': ["DURBAN YARD", "DURBAN", "BEREA ROAD", "DALBRIDGE", "CONGELLA", "UMBILO", "ROSSBURGH", "MOUNT VERNON", "CAVENDISH", "BURLINGTON", "SHALLCROSS", "KLAARWATER", "MARIANNHILL", "THORNWOOD", "SITUNDU HILLS", "DASSENHOEK", "KWANDENGEZI", "DELVILLE WOOD", "NSHONGWENI", "CLIFFDALE", "HAMMARSDALE", "KWATANDAZA", "GEORGEDALE", "CATO RIDGE"],
            'kzn-pinetown': ["DURBAN YARD", "DURBAN", "BEREA ROAD", "DALBRIDGE", "CONGELLA", "UMBILO", "ROSSBURGH", "SEA VIEW", "BELLAIR", "POET'S CORNER", "MALVERN", "ESCOMBE", "NORTHDENE", "MOSELEY", "GLEN PARK", "SARNIA", "PINETOWN"],
            'kzn-crossmoor': ["DURBAN YARD", "DURBAN", "BEREA ROAD", "DALBRIDGE", "CONGELLA", "UMBILO", "ROSSBURGH", "CLAIRWOOD", "MONTCLAIR", "MEREBANK", "HAVENSIDE", "BAYVIEW", "WESTCLIFF", "CHATSGLEN", "CROSSMOOR"],
            
            // --- EASTERN CAPE ---
            'ec-berlin': ["EAST LONDON", "SOUTHERNWOOD", "PANMURE", "CHISELHURST", "VINCENT", "CAMBRIDGE", "HIGHGATE", "HORSESHOE", "DAWN", "WILSONIA", "ARNOLDTON", "MTSOTSO", "MDANTSANE", "MOUNT RUTH", "EGERTON", "FORT JACKSON", "LONETREE", "BERLIN"]
        };

        // --- OSM rail tracks (static GeoJSON from scripts/build-rail-tracks.mjs) ---
        // Load baked route LineStrings + build a merged rail graph so we can
        // re-smooth station sequences (fixes straight-chord hops / missing routes).
        const RAIL_SNAP_MAX_M = 900;
        const RAIL_MAX_HOPS = 14000;

        function railHaversineM(lat1, lon1, lat2, lon2) {
            const R = 6371000;
            const toRad = (d) => (d * Math.PI) / 180;
            const dLat = toRad(lat2 - lat1);
            const dLon = toRad(lon2 - lon1);
            const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(a));
        }

        function railQuantizeKey(lat, lon) {
            return `${Math.round(lat / 0.00015)},${Math.round(lon / 0.00015)}`;
        }

        function buildRailGraphFromFeatures(features) {
            const nodes = [];
            const keyToId = new Map();
            const adj = new Map();
            const getOrCreate = (lat, lon) => {
                const k = railQuantizeKey(lat, lon);
                if (keyToId.has(k)) return keyToId.get(k);
                const id = nodes.length;
                nodes.push({ lat, lon });
                keyToId.set(k, id);
                adj.set(id, []);
                return id;
            };
            const addEdge = (a, b, w) => {
                adj.get(a).push({ to: b, w });
                adj.get(b).push({ to: a, w });
            };
            for (const f of features || []) {
                const geom = f?.geometry;
                if (!geom) continue;
                const lines = geom.type === 'LineString'
                    ? [geom.coordinates]
                    : (geom.type === 'MultiLineString' ? geom.coordinates : []);
                for (const line of lines) {
                    let prev = null;
                    for (const pair of line) {
                        if (!pair || pair.length < 2) continue;
                        const [lon, lat] = pair;
                        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
                        const id = getOrCreate(lat, lon);
                        if (prev != null && prev !== id) {
                            const A = nodes[prev];
                            const B = nodes[id];
                            const w = railHaversineM(A.lat, A.lon, B.lat, B.lon);
                            // Skip absurd teleport edges left over from bake-time chord fallbacks
                            if (w > 0 && w < 2500) addEdge(prev, id, w);
                        }
                        prev = id;
                    }
                }
            }
            return { nodes, adj };
        }

        function nearestRailNode(graph, lat, lon, maxM = RAIL_SNAP_MAX_M) {
            let best = null;
            let bestD = Infinity;
            for (let id = 0; id < graph.nodes.length; id++) {
                if (!graph.adj.get(id)?.length) continue;
                const n = graph.nodes[id];
                const d = railHaversineM(lat, lon, n.lat, n.lon);
                if (d < bestD) { bestD = d; best = id; }
            }
            if (best == null || bestD > maxM) return null;
            return best;
        }

        function shortestRailPath(graph, startId, endId) {
            if (startId === endId) return [startId];
            const dist = new Map([[startId, 0]]);
            const prev = new Map();
            const pq = [[0, startId]];
            let hops = 0;
            while (pq.length) {
                let minIdx = 0;
                for (let i = 1; i < pq.length; i++) {
                    if (pq[i][0] < pq[minIdx][0]) minIdx = i;
                }
                const [d, u] = pq.splice(minIdx, 1)[0];
                if (d !== dist.get(u)) continue;
                if (u === endId) break;
                if (++hops > RAIL_MAX_HOPS) return null;
                for (const { to, w } of graph.adj.get(u) || []) {
                    const nd = d + w;
                    if (nd < (dist.get(to) ?? Infinity)) {
                        dist.set(to, nd);
                        prev.set(to, u);
                        pq.push([nd, to]);
                    }
                }
            }
            if (!prev.has(endId) && startId !== endId) return null;
            const path = [endId];
            for (let cur = endId; cur !== startId; ) {
                cur = prev.get(cur);
                if (cur == null) return null;
                path.push(cur);
            }
            path.reverse();
            return path;
        }

        function smoothStopsOnRailGraph(graph, stops) {
            if (!graph?.nodes?.length || !Array.isArray(stops) || stops.length < 2) return null;
            const out = [];
            let railHops = 0;
            for (let i = 0; i < stops.length - 1; i++) {
                const a = stops[i];
                const b = stops[i + 1];
                if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) continue;
                const snapA = nearestRailNode(graph, a.lat, a.lon);
                const snapB = nearestRailNode(graph, b.lat, b.lon);
                if (snapA != null && snapB != null) {
                    const nodePath = shortestRailPath(graph, snapA, snapB);
                    if (nodePath && nodePath.length >= 2) {
                        const seg = nodePath.map((id) => [graph.nodes[id].lat, graph.nodes[id].lon]);
                        if (!out.length) out.push(...seg);
                        else out.push(...seg.slice(1));
                        railHops++;
                        continue;
                    }
                }
                if (!out.length) out.push([a.lat, a.lon]);
                out.push([b.lat, b.lon]);
            }
            if (out.length < 2 || railHops === 0) return null;
            const deduped = [out[0]];
            for (let i = 1; i < out.length; i++) {
                const p = out[i];
                const prev = deduped[deduped.length - 1];
                if (p[0] !== prev[0] || p[1] !== prev[1]) deduped.push(p);
            }
            return deduped.length > 1 ? deduped : null;
        }

        function nearestPathIndex(path, lat, lon) {
            if (!path?.length) return -1;
            let best = 0;
            let bestD = Infinity;
            for (let i = 0; i < path.length; i++) {
                const dLat = path[i][0] - lat;
                const dLon = path[i][1] - lon;
                const d = dLat * dLat + dLon * dLon;
                if (d < bestD) { bestD = d; best = i; }
            }
            return best;
        }

        function pathHasLargeJumps(latlngs, maxM = 1500) {
            if (!latlngs || latlngs.length < 2) return true;
            for (let i = 1; i < latlngs.length; i++) {
                const a = latlngs[i - 1];
                const b = latlngs[i];
                if (railHaversineM(a[0], a[1], b[0], b[1]) > maxM) return true;
            }
            return false;
        }

        async function loadRailTrackBundle(region) {
            const byId = new Map();
            let graph = null;
            try {
                const base = (typeof window.APP_BASE === 'string' && window.APP_BASE)
                    ? window.APP_BASE
                    : '/';
                const root = base.endsWith('/') ? base : `${base}/`;
                // /tracks/ (not /data/) — production rsync excludes metrorail-app/data/
                const url = `${root}tracks/rail-tracks-${region}.geojson`;
                const res = await fetch(url, { cache: 'default' });
                if (!res.ok) return { byId, graph: null };
                const fc = await res.json();
                const features = fc.features || [];
                for (const f of features) {
                    const id = f.properties?.routeId;
                    const geom = f.geometry;
                    if (!id || !geom) continue;
                    let latlngs = [];
                    if (geom.type === 'LineString') {
                        latlngs = geom.coordinates.map(([lon, lat]) => [lat, lon]);
                    } else if (geom.type === 'MultiLineString') {
                        // Keep as separate lines — do NOT concatenate (creates teleport chords)
                        let best = [];
                        for (const line of geom.coordinates) {
                            const ll = line.map(([lon, lat]) => [lat, lon]);
                            if (ll.length > best.length) best = ll;
                        }
                        latlngs = best;
                    }
                    if (latlngs.length > 1) byId.set(id, latlngs);
                }
                graph = buildRailGraphFromFeatures(features);
            } catch (e) {
                console.warn('Guardian: OSM track GeoJSON unavailable, using station chords.', e);
            }
            return { byId, graph };
        }

        /** Prefer graph-smoothed path; else baked LineString; else station chords. */
        function resolveRouteLatLngs(routeObj, trackBundle) {
            const stops = routeObj.validStops || [];
            const baked = trackBundle.byId.get(routeObj.routeId);
            if (trackBundle.graph) {
                const smoothed = smoothStopsOnRailGraph(trackBundle.graph, stops);
                if (smoothed && smoothed.length > 1) return smoothed;
            }
            if (baked && baked.length > 1 && !pathHasLargeJumps(baked)) return baked;
            if (baked && baked.length > 1) return baked;
            return routeObj.coords;
        }

        // --- MAP LOGIC (Dynamic Region & DB Sync) ---
        const VALID_MAP_REGIONS = ['GP', 'WC', 'KZN', 'EC'];
        const DEFAULT_REGION_SLUGS = {
            GP: 'gauteng',
            WC: 'western-cape',
            KZN: 'kwazulu-natal',
            EC: 'eastern-cape'
        };

        function readSavedAppRegion() {
            try {
                const stored = localStorage.getItem('userRegion');
                if (stored && VALID_MAP_REGIONS.includes(stored)) return stored;
            } catch (e) {}
            return null;
        }

        /** Map view region only — never overwrite a returning user's saved app region/route. */
        function resolveMapRegion() {
            try {
                const q = new URLSearchParams(location.search).get('region');
                if (q) {
                    const up = String(q).toUpperCase();
                    if (VALID_MAP_REGIONS.includes(up)) {
                        try { sessionStorage.setItem('nt_mapViewRegion', up); } catch (e) {}
                        return up;
                    }
                }
            } catch (e) {}
            try {
                const session = sessionStorage.getItem('nt_mapViewRegion');
                if (session && VALID_MAP_REGIONS.includes(session)) return session;
            } catch (e) {}
            const saved = readSavedAppRegion();
            if (saved) return saved;
            // Cold start only: no app region yet — seed GP so first-time map visitors can load
            try { localStorage.setItem('userRegion', 'GP'); } catch (e) {}
            return 'GP';
        }

        function regionRoutesHref(region) {
            const slugs = (typeof window.REGION_SEO_SLUGS === 'object' && window.REGION_SEO_SLUGS)
                ? window.REGION_SEO_SLUGS
                : DEFAULT_REGION_SLUGS;
            const slug = slugs[region] || DEFAULT_REGION_SLUGS[region] || 'gauteng';
            const base = (typeof window.APP_BASE === 'string' ? window.APP_BASE : '/').replace(/\/?$/, '/');
            return `${base}regions/${slug}.html`;
        }

        function syncMapChromeRegion(region) {
            const code = VALID_MAP_REGIONS.includes(region) ? region : 'GP';
            const label = document.getElementById('region-toggle-label');
            if (label) label.textContent = code;
            const btn = document.getElementById('region-toggle-btn');
            if (btn) btn.setAttribute('aria-label', `Map region ${code}. Change region`);
            document.querySelectorAll('#region-panel [data-region]').forEach((el) => {
                el.classList.toggle('is-active', el.getAttribute('data-region') === code);
            });
            const back = document.getElementById('map-back-link');
            if (back) back.setAttribute('href', regionRoutesHref(code));
        }

        function switchMapRegion(region) {
            const code = String(region || '').toUpperCase();
            if (!VALID_MAP_REGIONS.includes(code)) return;
            try { sessionStorage.setItem('nt_mapViewRegion', code); } catch (e) {}
            // Persist to app profile only when the user has never chosen a region
            try {
                if (!localStorage.getItem('userRegion')) {
                    localStorage.setItem('userRegion', code);
                }
            } catch (e) {}
            try {
                const url = new URL(location.href);
                url.searchParams.set('region', code);
                location.assign(url.toString());
            } catch (e) {
                location.reload();
            }
        }

        function showMapColdStartPanel(err) {
            console.warn("Guardian: Map Init Failed (cold-start safe).", err);
            const placeholder = document.getElementById('map-placeholder');
            if (placeholder) placeholder.style.display = 'none';
            const panel = document.getElementById('map-cold-start');
            if (panel) panel.classList.remove('hidden');
        }

        function bindMapRegionPicker() {
            const picker = document.getElementById('region-picker');
            const toggle = document.getElementById('region-toggle-btn');
            if (!picker || !toggle || picker.dataset.bound === '1') return;
            picker.dataset.bound = '1';

            const closePicker = () => {
                picker.classList.remove('is-open');
                toggle.setAttribute('aria-expanded', 'false');
                const panel = document.getElementById('region-panel');
                if (panel) {
                    panel.classList.remove('is-viewport-clamped');
                    panel.style.position = '';
                    panel.style.left = '';
                    panel.style.right = '';
                    panel.style.top = '';
                    panel.style.width = '';
                }
            };
            const openPicker = () => {
                const legend = document.getElementById('legend-container');
                if (legend) {
                    legend.classList.remove('is-open');
                    document.getElementById('legend-toggle-btn')?.setAttribute('aria-expanded', 'false');
                }
                picker.classList.add('is-open');
                toggle.setAttribute('aria-expanded', 'true');
                // Keep menu inside the viewport (left chrome / narrow phones)
                try {
                    const panel = document.getElementById('region-panel');
                    if (panel) {
                        panel.classList.remove('is-viewport-clamped');
                        panel.style.left = '0px';
                        panel.style.right = 'auto';
                        panel.style.top = '';
                        panel.style.width = '';
                        const toggleRect = toggle.getBoundingClientRect();
                        let pan = panel.getBoundingClientRect();
                        const overflowLeft = pan.left < 8;
                        const overflowRight = pan.right > window.innerWidth - 8;
                        if (overflowLeft || overflowRight) {
                            // Fixed to viewport — absolute+right cluster still clips on some phones
                            const width = Math.min(220, window.innerWidth - 16);
                            let left = Math.min(Math.max(8, toggleRect.left), window.innerWidth - 8 - width);
                            panel.classList.add('is-viewport-clamped');
                            panel.style.position = 'fixed';
                            panel.style.left = `${left}px`;
                            panel.style.right = 'auto';
                            panel.style.top = `${toggleRect.bottom + 6}px`;
                            panel.style.width = `${width}px`;
                        }
                    }
                } catch (_) {}
            };

            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                if (picker.classList.contains('is-open')) closePicker();
                else openPicker();
            });
            picker.querySelectorAll('[data-region]').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    switchMapRegion(btn.getAttribute('data-region'));
                });
            });
            document.addEventListener('click', (e) => {
                if (!picker.contains(e.target)) closePicker();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') closePicker();
            });
        }

        function bindMapColdStartControls() {
            const panel = document.getElementById('map-cold-start');
            if (!panel || panel.dataset.bound === '1') return;
            panel.dataset.bound = '1';
            panel.querySelectorAll('[data-region]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    switchMapRegion(btn.getAttribute('data-region') || 'GP');
                });
            });
            document.getElementById('map-retry-btn')?.addEventListener('click', () => window.location.reload());
        }

        window.addEventListener('load', async () => {
            const bootRegion = resolveMapRegion();
            syncMapChromeRegion(bootRegion);
            bindMapRegionPicker();
            bindMapColdStartControls();
            try {
                await initDynamicMap();
                
                // Remove placeholder on success
                const placeholder = document.getElementById('map-placeholder');
                if(placeholder) {
                    placeholder.style.opacity = '0';
                    setTimeout(() => placeholder.style.display = 'none', 500);
                }
                const legend = document.getElementById('legend-container');
                if(legend) legend.style.display = 'block';
                const cold = document.getElementById('map-cold-start');
                if (cold) cold.classList.add('hidden');

            } catch (err) {
                // Soft fail: friendly panel + region picker (no hard redirect / crash loop)
                showMapColdStartPanel(err);
            }
        });

        async function fetchNetworkDB(region) {
            const pipelines = (typeof PIPELINE_SOURCES !== 'undefined' && PIPELINE_SOURCES) ? PIPELINE_SOURCES : {
                CLOUDFLARE: { url: "https://nexttrain-cache.enock.workers.dev/", useRootNode: false },
                GITHUB: { url: "https://cdn.jsdelivr.net/gh/enock-elk/next-train-astro@main/public/data/", useRootNode: true },
                FIREBASE: { url: "https://metrorail-next-train-default-rtdb.firebaseio.com/", useRootNode: false }
            };
            const regions = (typeof REGIONS !== 'undefined' && REGIONS) ? REGIONS : {
                GP: { dbNode: 'schedules/gauteng.json', rootNode: 'full-database.json' },
                WC: { dbNode: 'schedules/westerncape.json', rootNode: 'full-database.json' },
                KZN: { dbNode: 'schedules/kzn.json', rootNode: 'full-database.json' },
                EC: { dbNode: 'schedules/easterncape.json', rootNode: 'full-database.json' }
            };
            const regionCfg = regions[region] || regions.GP;
            for (const key of ['CLOUDFLARE', 'GITHUB', 'FIREBASE']) {
                const src = pipelines[key];
                if (!src || !regionCfg) continue;
                const nodePath = src.useRootNode ? regionCfg.rootNode : regionCfg.dbNode;
                const sep = src.url.includes('?') ? '&' : '?';
                const url = src.url + nodePath + sep + 't=' + Date.now();
                try {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), key === 'CLOUDFLARE' ? 8000 : 12000);
                    const resp = await fetch(url, { signal: controller.signal });
                    clearTimeout(timer);
                    if (!resp.ok) continue;
                    const data = await resp.json();
                    if (!data) continue;
                    try {
                        localStorage.setItem(`full_db_${region}`, JSON.stringify({ data, timestamp: Date.now() }));
                    } catch (e) {}
                    return data;
                } catch (e) { /* try next source */ }
            }
            return null;
        }

        // Guardian: Local DB extractor + network cold-start fallback
        async function fetchLocalDB(region) {
            const cacheKey = `full_db_${region}`;
            
            // 1. Try IndexedDB (V6.00.12+ Standard)
            try {
                const db = await new Promise((resolve, reject) => {
                    if (!window.indexedDB) reject();
                    const req = indexedDB.open('NextTrainDB', 1);
                    req.onerror = () => reject();
                    req.onupgradeneeded = (e) => {
                        const tempDb = e.target.result;
                        if (!tempDb.objectStoreNames.contains('SchedulesStore')) {
                            tempDb.createObjectStore('SchedulesStore');
                        }
                    };
                    req.onsuccess = (e) => resolve(e.target.result);
                });
                if (db && db.objectStoreNames.contains('SchedulesStore')) {
                    const data = await new Promise((resolve) => {
                        const tx = db.transaction('SchedulesStore', 'readonly');
                        const store = tx.objectStore('SchedulesStore');
                        const req = store.get(cacheKey);
                        req.onsuccess = () => resolve(req.result);
                        req.onerror = () => resolve(null);
                    });
                    if (data && data.data) return data.data;
                }
            } catch(e) { console.warn("IDB fetch failed, falling back to LocalStorage."); }
            
            // 2. Fallback to LocalStorage (Legacy Standard)
            try {
                const ls = localStorage.getItem(cacheKey);
                if (ls) {
                    const parsed = JSON.parse(ls);
                    return parsed.data ? parsed.data : parsed;
                }
            } catch(e) { console.warn("LS fetch failed."); }

            // 3. Cold-start: brand-new visitors have no cache — fetch from pipeline
            if (typeof navigator === 'undefined' || navigator.onLine !== false) {
                const net = await fetchNetworkDB(region);
                if (net) return net;
            }
            
            return null;
        }

        // Unwraps the database payload securely
        const unwrapDatabase = (db, region) => {
            if (!db) return null;
            let regionalData = {};
            if (region === 'GP' && db.gauteng) regionalData = db.gauteng;
            else if (region === 'WC' && db.westerncape) regionalData = db.westerncape;
            else if (region === 'KZN' && db.kzn) regionalData = db.kzn;
            else if (region === 'EC' && db.easterncape) regionalData = db.easterncape;
            else if (region === 'GP' && db.schedules && !db.gauteng) regionalData = db.schedules;
            return { ...db, ...regionalData };
        };

        function parseDisruptionsPayload(disrData) {
            const globalDisruptions = {};
            if (!disrData) return globalDisruptions;
            const now = Date.now();
            Object.keys(disrData).forEach((routeKey) => {
                const routeObj = disrData[routeKey];
                if (routeObj && typeof routeObj === 'object') {
                    Object.values(routeObj).forEach((d) => {
                        if (d && (!d.expiresAt || d.expiresAt > now)) {
                            const rid = d.routeId || routeKey;
                            if (!globalDisruptions[rid]) globalDisruptions[rid] = [];
                            globalDisruptions[rid].push(d);
                        }
                    });
                }
            });
            return globalDisruptions;
        }

        async function fetchLiveDisruptions() {
            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                const disrResp = await fetch(`${dynamicEndpoint}disruptions.json?t=${Date.now()}`);
                if (!disrResp.ok) return {};
                return parseDisruptionsPayload(await disrResp.json());
            } catch (e) {
                console.warn('Disruptions fetch failed.');
                return {};
            }
        }

        function disruptionPopupHtml(d) {
            const isCritical = d && d.tier === 'CRITICAL';
            const title = isCritical ? 'LINE SEVERED' : 'EXPECT DELAYS';
            const raw = String(d?.message || d?.longExplanation || 'Service warning on this section.')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 280);
            const msg = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
            return `<div class="text-left max-w-[220px]"><b class="text-xs">${title}</b><br><span class="text-[11px] leading-snug">${msg}</span></div>`;
        }

        function attachMapDisruptionPopup(layer, d) {
            if (!layer || !d) return layer;
            layer.bindPopup(disruptionPopupHtml(d), { maxWidth: 260 });
            return layer;
        }

        async function initDynamicMap() {
            if (typeof L === 'undefined') throw new Error("Leaflet Missing");
            if (typeof ROUTES === 'undefined') throw new Error("Config Missing");

            // Guardian: URL ?region= → localStorage → GP
            const currentRegion = resolveMapRegion();
            syncMapChromeRegion(currentRegion);
            
            // Center map dynamically based on region
            let initLat = -26.00, initLon = 28.10, initZoom = 10;
            if (currentRegion === 'WC') {
                initLat = -33.95; initLon = 18.50; initZoom = 11;
            } else if (currentRegion === 'KZN') {
                initLat = -29.85; initLon = 30.95; initZoom = 11;
            } else if (currentRegion === 'EC') {
                initLat = -32.95; initLon = 27.75; initZoom = 11;
            }

            // Guardian UX: Disabled Leaflet's rigid zoom control for horizontal bar layout
            const map = L.map('map', { zoomControl: false }).setView([initLat, initLon], initZoom); 
            
            // Guardian UX: "Midnight Blue" unified tile layer
            // CSS filter (.dark .leaflet-tile-pane) flips this strictly in dark mode
            const voyagerTiles = (typeof window.ntCartoVoyagerUrl === 'function')
                ? window.ntCartoVoyagerUrl()
                : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
            
            const tileLayer = L.tileLayer(voyagerTiles, {
                attribution: '&copy; OpenStreetMap &copy; CARTO',
                subdomains: 'abcd',
                maxZoom: 19
            }).addTo(map);

            // Fetch schedule DB, live disruptions, and OSM tracks in parallel
            const dbPromise = fetchLocalDB(currentRegion);
            const disruptionsPromise = fetchLiveDisruptions();
            const tracksPromise = loadRailTrackBundle(currentRegion);

            const rawDb = await dbPromise;
            if (!rawDb) throw new Error("No Local Database Cached");
            const mergedDb = unwrapDatabase(rawDb, currentRegion);

            let globalDisruptions = {};

            // --- DYNAMIC ROUTE & STATION EXTRACTOR ---
            const colorMap = {
                'text-green-500': '#22c55e',
                'text-lime-500': '#84cc16', 
                'text-orange-500': '#f97316',
                'text-purple-500': '#a855f7',
                'text-indigo-500': '#6366f1',
                'text-blue-500': '#3b82f6',
                'text-yellow-600': '#ca8a04', 
                'text-yellow-500': '#eab308',
                'text-red-500': '#ef4444'
            };

            const globalStations = {}; // { name: {lat, lon, origName, routes: Set()} }
            const drawnRoutes = []; // { routeId, name, color, isActive, coords: [], validStops: [] }
            const hubs = new Set();
            const ends = new Set();

            function stopsAreAdjacent(stops, a, b) {
                const names = (stops || []).map((s) => s.name);
                for (let i = 0; i < names.length - 1; i++) {
                    if ((names[i] === a && names[i + 1] === b) || (names[i] === b && names[i + 1] === a)) return true;
                }
                return false;
            }

            /** Official corridor: Koeberg Rd → Maitland → Mutual. */
            function ensureMaitlandMutualAdjacency(validStops, routeCoords) {
                const mai = STATION_COORDINATES.MAITLAND;
                const mut = STATION_COORDINATES.MUTUAL;
                if (!mai || !mut || !validStops.length) return;
                if (stopsAreAdjacent(validStops, 'MAITLAND', 'MUTUAL')) return;
                const names = validStops.map((s) => s.name);
                const iMut = names.indexOf('MUTUAL');
                const iMai = names.indexOf('MAITLAND');
                const insertAt = (idx, name, coord) => {
                    validStops.splice(idx, 0, { name, lat: coord[0], lon: coord[1] });
                    routeCoords.splice(idx, 0, coord);
                    if (!globalStations[name]) {
                        globalStations[name] = { lat: coord[0], lon: coord[1], origName: name, routes: new Set() };
                    }
                };
                const prevIsEastBranch = (idx) => {
                    const prev = names[idx - 1];
                    return prev === 'LANGA' || prev === 'BONTEHEUWEL' || prev === 'NDABENI' || prev === 'PINELANDS';
                };
                if (iMut >= 0 && iMai < 0) {
                    insertAt(prevIsEastBranch(iMut) ? iMut + 1 : iMut, 'MAITLAND', mai);
                } else if (iMai >= 0 && iMut < 0) {
                    insertAt(iMai + 1, 'MUTUAL', mut);
                }
            }

            Object.values(ROUTES).forEach(route => {
                if (route.region !== currentRegion || route.id === 'special_event') return;

                // Track Hubs and Terminals to size markers properly later
                if (route.destA) ends.add(route.destA.replace(/ STATION/gi, '').trim().toUpperCase());
                if (route.destB) ends.add(route.destB.replace(/ STATION/gi, '').trim().toUpperCase());
                if (route.transferStation) hubs.add(route.transferStation.replace(/ STATION/gi, '').trim().toUpperCase());
                if (route.relayStation) hubs.add(route.relayStation.replace(/ STATION/gi, '').trim().toUpperCase());

                let sheetKey = route.sheetKeys.weekday_to_a;
                let sheetData = mergedDb[sheetKey];
                
                if (!sheetData) {
                    sheetKey = route.sheetKeys.weekday_to_b;
                    sheetData = mergedDb[sheetKey];
                }

                let routeCoords = [];
                let validStops = [];
                let extractedDynamically = false;

                if (sheetData && Array.isArray(sheetData)) {
                    let stationKey = 'STATION';
                    let coordKey = 'COORDINATES';
                    let startIndex = 0;

                    // 🛡️ GUARDIAN FIX: Universal Format Detector
                    let foundHeader = false;
                    for (let i = 0; i < Math.min(sheetData.length, 5); i++) {
                        const row = sheetData[i];
                        for (const k of Object.keys(row)) {
                            if (String(row[k]).toUpperCase().trim() === 'STATION') {
                                stationKey = k;
                                foundHeader = true;
                                for (const ck of Object.keys(row)) {
                                    if (String(row[ck]).toUpperCase().trim() === 'COORDINATES') coordKey = ck;
                                }
                                startIndex = i + 1; // Start AFTER the detected header row
                                break;
                            }
                        }
                        if (foundHeader) break;
                    }

                    for (let i = startIndex; i < sheetData.length; i++) {
                        const row = sheetData[i];
                        if (!row || !row[stationKey]) continue;
                        
                        const sNameOrig = String(row[stationKey]).trim();
                        if (sNameOrig.toLowerCase().includes('last updated') || sNameOrig.toLowerCase().includes('inter-station')) continue;

                        // 🛡️ GUARDIAN FIX: Ghost Row Pruning
                        const hasData = Object.keys(row).some(k => k !== stationKey && k !== coordKey && k !== 'KM_MARK' && k !== 'row_index' && row[k] && String(row[k]).trim() !== "" && String(row[k]).trim() !== "-");
                        if (!hasData) continue;

                        const sName = sNameOrig.replace(/ STATION/gi, '').toUpperCase();

                        let lat = null, lon = null;
                        const cVal = row[coordKey];
                        if (cVal) {
                            const parts = String(cVal).split(',').map(s => parseFloat(s.trim()));
                            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) { 
                                lat = parts[0]; lon = parts[1]; 
                            }
                        }

                        // Rescue missing coordinates
                        if (lat === null && STATION_COORDINATES[sName]) {
                            lat = STATION_COORDINATES[sName][0];
                            lon = STATION_COORDINATES[sName][1];
                        }
                        if (lat === null && globalStations[sName]) {
                            lat = globalStations[sName].lat;
                            lon = globalStations[sName].lon;
                        }

                        if (lat !== null && lon !== null) {
                            routeCoords.push([lat, lon]);
                            validStops.push({ name: sName, lat: lat, lon: lon });
                            if (!globalStations[sName]) {
                                globalStations[sName] = { lat, lon, origName: sNameOrig, routes: new Set() };
                            }
                            globalStations[sName].routes.add(route.id);
                        }
                    }
                    
                    if (routeCoords.length > 1) {
                        extractedDynamically = true;
                    }
                }

                // 🛡️ GUARDIAN HYBRID FALLBACK: Force static definitions
                if (!extractedDynamically) {
                    routeCoords = [];
                    validStops = [];
                    if (STATIC_ROUTE_PATHS[route.id]) {
                        STATIC_ROUTE_PATHS[route.id].forEach(sName => {
                            let lat = null, lon = null;
                            if (STATION_COORDINATES[sName]) {
                                lat = STATION_COORDINATES[sName][0];
                                lon = STATION_COORDINATES[sName][1];
                            } else if (globalStations[sName]) {
                                lat = globalStations[sName].lat;
                                lon = globalStations[sName].lon;
                            }

                            if (lat !== null && lon !== null) {
                                routeCoords.push([lat, lon]);
                                validStops.push({ name: sName, lat: lat, lon: lon });
                                if (!globalStations[sName]) {
                                    globalStations[sName] = { lat, lon, origName: sName, routes: new Set() };
                                }
                                globalStations[sName].routes.add(route.id);
                            }
                        });
                    }
                }

                if (currentRegion === 'WC') ensureMaitlandMutualAdjacency(validStops, routeCoords);

                if (routeCoords.length > 1) {
                     drawnRoutes.push({
                         routeId: route.id,
                         name: route.name.replace(/<->/g, '↔'),
                         color: colorMap[route.colorClass] || '#9ca3af',
                         isActive: route.isActive,
                         coords: routeCoords,
                         validStops: validStops
                     });
                }
            });

            if (currentRegion === 'WC' && !drawnRoutes.some((r) => stopsAreAdjacent(r.validStops, 'MAITLAND', 'MUTUAL'))) {
                const mai = STATION_COORDINATES.MAITLAND;
                const mut = STATION_COORDINATES.MUTUAL;
                if (mai && mut) {
                    drawnRoutes.push({
                        routeId: 'wc-maitland-mutual',
                        name: 'Maitland ↔ Mutual',
                        color: '#22c55e',
                        isActive: true,
                        coords: [mai, mut],
                        validStops: [
                            { name: 'MAITLAND', lat: mai[0], lon: mai[1] },
                            { name: 'MUTUAL', lat: mut[0], lon: mut[1] }
                        ]
                    });
                }
            }

            // 🛡️ GUARDIAN UX FIX: Empty Map Warning
            if (drawnRoutes.length === 0) {
                const warningBox = document.getElementById('empty-map-warning');
                if (warningBox) warningBox.classList.remove('hidden');
                return; // Stop drawing Leaflet elements
            }

            // --- OSM TRACK GEOMETRY (cached GeoJSON + live graph smooth) ---
            // © OpenStreetMap contributors — baked offline via scripts/build-rail-tracks.mjs
            const overlayGroup = L.layerGroup().addTo(map);
            const emptyTracks = { byId: new Map(), graph: null };

            function paintRouteLines(trackBundle) {
                drawnRoutes.forEach((r) => {
                    const isLive = r.isActive;
                    const lineCoords = resolveRouteLatLngs(r, trackBundle);
                    r.trackCoords = lineCoords;
                    if (r._polyline) map.removeLayer(r._polyline);
                    r._polyline = L.polyline(lineCoords, {
                        color: r.color,
                        weight: isLive ? 4 : 3,
                        opacity: isLive ? 0.9 : 0.35,
                        dashArray: isLive ? null : '8, 12',
                        lineCap: 'round',
                        lineJoin: 'round',
                        smoothFactor: 1
                    }).addTo(map).bindPopup(`
                    <div class="text-center">
                        <b class="uppercase text-sm">${r.name}</b><br>
                        ${isLive
                            ? '<span class="text-green-600 font-bold text-xs">● Active Service</span>'
                            : '<span class="text-blue-500 font-black text-[10px] uppercase tracking-widest animate-pulse">🚧 Launching Soon</span>'}
                    </div>
                `);
                });
            }

            function paintDisruptionOverlays(trackBundle, disruptions) {
                overlayGroup.clearLayers();
                const drawnIncidentIds = new Set();

                drawnRoutes.forEach((routeObj) => {
                    Object.values(disruptions || {}).flat().forEach((d) => {
                        if (!d || drawnIncidentIds.has(d.id + '_' + routeObj.routeId)) return;

                        const isCritical = d.tier === 'CRITICAL';
                        const color = isCritical ? '#ef4444' : '#eab308';
                        const currentValidStops = routeObj.validStops;
                        const trackPath = (routeObj.trackCoords && routeObj.trackCoords.length > 1)
                            ? routeObj.trackCoords
                            : routeObj.coords;
                        if (!trackPath || trackPath.length < 1) return;

                        const iconHtml = `<div class="flex items-center justify-center rounded-full shadow-md border-2 border-white" style="width: 22px; height: 22px; background-color: ${color};"><span class="text-[11px] text-white font-black">${isCritical ? '✕' : '!'}</span></div>`;
                        const alertIcon = L.divIcon({ className: 'custom-map-dot z-50', html: iconHtml, iconSize: [22, 22], iconAnchor: [11, 11] });

                        const addWarning = (latlng, tooltipHtml, tooltipOpts) => {
                            const marker = L.marker(latlng, { icon: alertIcon, interactive: true });
                            attachMapDisruptionPopup(marker, d);
                            if (tooltipHtml) marker.bindTooltip(tooltipHtml, tooltipOpts);
                            marker.addTo(overlayGroup);
                            return marker;
                        };
                        const addDash = (latlngs) => {
                            const line = L.polyline(latlngs, {
                                color, weight: 10, opacity: 0.8, dashArray: '10, 12', lineCap: 'round', lineJoin: 'round', className: 'disruption-line-overlay'
                            });
                            attachMapDisruptionPopup(line, d);
                            line.addTo(overlayGroup);
                            return line;
                        };

                        if (!d.stations || d.stations.length === 0) {
                            if (d.routeId === routeObj.routeId) {
                                drawnIncidentIds.add(d.id + '_' + routeObj.routeId);
                                addDash(trackPath);
                                const startIdx = 0;
                                const endIdx = trackPath.length - 1;
                                addWarning(trackPath[startIdx]);
                                addWarning(trackPath[endIdx]);
                                const midIndexExact = (startIdx + endIdx) / 2;
                                let midLat = 0, midLon = 0;
                                if (midIndexExact % 1 === 0) {
                                    midLat = trackPath[midIndexExact][0];
                                    midLon = trackPath[midIndexExact][1];
                                } else {
                                    const f = Math.floor(midIndexExact);
                                    const c = Math.ceil(midIndexExact);
                                    midLat = (trackPath[f][0] + trackPath[c][0]) / 2;
                                    midLon = (trackPath[f][1] + trackPath[c][1]) / 2;
                                }
                                addWarning([midLat, midLon], `<b>${isCritical ? 'LINE SEVERED' : 'EXPECT DELAYS'}</b>`, {
                                    permanent: true, direction: 'center', className: 'font-bold text-[10px] text-gray-900 z-50 tooltip-dynamic tooltip-halo'
                                });
                            }
                        } else {
                            const normStations = d.stations.map((s) => s.replace(/ STATION/gi, '').trim().toUpperCase());
                            const routeStationNames = currentValidStops.map((s) => s.name);

                            if (normStations.length >= 2) {
                                if (routeStationNames.includes(normStations[0]) && routeStationNames.includes(normStations[1])) {
                                    const idx1 = routeStationNames.indexOf(normStations[0]);
                                    const idx2 = routeStationNames.indexOf(normStations[1]);
                                    const s1 = currentValidStops[idx1];
                                    const s2 = currentValidStops[idx2];
                                    if (!s1 || !s2) return;

                                    drawnIncidentIds.add(d.id + '_' + routeObj.routeId);
                                    const i1 = nearestPathIndex(trackPath, s1.lat, s1.lon);
                                    const i2 = nearestPathIndex(trackPath, s2.lat, s2.lon);
                                    if (i1 < 0 || i2 < 0) return;
                                    const start = Math.min(i1, i2);
                                    const end = Math.max(i1, i2);
                                    const segment = trackPath.slice(start, end + 1);
                                    if (segment.length < 2) return;

                                    addDash(segment);
                                    addWarning(trackPath[start]);
                                    addWarning(trackPath[end]);
                                    const midPt = trackPath[Math.floor((start + end) / 2)];
                                    if (midPt) {
                                        addWarning(midPt, `<b>${isCritical ? 'LINE SEVERED' : 'EXPECT DELAYS'}</b>`, {
                                            permanent: true, direction: 'center', className: 'font-bold text-[10px] text-gray-900 z-50 tooltip-dynamic tooltip-halo'
                                        });
                                    }
                                }
                            } else if (normStations.length === 1) {
                                if (routeStationNames.includes(normStations[0])) {
                                    const idx1 = routeStationNames.indexOf(normStations[0]);
                                    drawnIncidentIds.add(d.id + '_' + routeObj.routeId);
                                    const s1 = currentValidStops[idx1];
                                    addWarning([s1.lat, s1.lon], `<b>${isCritical ? 'STATION INCIDENT' : 'STATION DELAYS'}</b>`, {
                                        permanent: true, direction: 'top', offset: [0, -12], className: 'font-bold text-[10px] text-gray-900 z-50 tooltip-dynamic tooltip-halo'
                                    });
                                }
                            }
                        }
                    });
                });
            }

            // Phase 1: station-chord overlays as soon as coords exist
            paintRouteLines(emptyTracks);

            const [disruptionData, trackBundle] = await Promise.all([
                disruptionsPromise.then((d) => {
                    globalDisruptions = d || {};
                    paintDisruptionOverlays(emptyTracks, globalDisruptions);
                    return globalDisruptions;
                }),
                tracksPromise
            ]);
            globalDisruptions = disruptionData || {};

            // Phase 2: refine polylines onto OSM tracks, then redraw warnings
            paintRouteLines(trackBundle);
            paintDisruptionOverlays(trackBundle, globalDisruptions);

            // --- PHASE 8: COMMUTER DELAY REPORT PINS (recent, by station) ---
            try {
                const drEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                const drResp = await fetch(`${drEndpoint}delay_reports.json?t=${Date.now()}`);
                if (drResp.ok) {
                    const drData = await drResp.json();
                    const cut = Date.now() - (3 * 60 * 60 * 1000);
                    const reportIcon = L.divIcon({
                        className: 'delay-report-pin',
                        html: '<div style="width:14px;height:14px;border-radius:9999px;background:#f59e0b;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>',
                        iconSize: [14, 14],
                        iconAnchor: [7, 7]
                    });
                    if (drData && typeof drData === 'object') {
                        Object.values(drData).forEach((r) => {
                            if (!r || r.status === 'closed' || (r.timestamp || 0) < cut) return;
                            const raw = (r.station || '').toString().trim();
                            if (!raw) return;
                            const variants = [
                                raw.toUpperCase(),
                                raw.toUpperCase().replace(/ STATION$/i, '') + ' STATION',
                                raw.toUpperCase().replace(/ STATION$/i, '')
                            ];
                            let coords = null;
                            for (const key of variants) {
                                if (STATION_COORDINATES[key]) { coords = STATION_COORDINATES[key]; break; }
                                const found = Object.keys(STATION_COORDINATES).find(k => k.replace(/ STATION$/i, '') === key.replace(/ STATION$/i, ''));
                                if (found) { coords = STATION_COORDINATES[found]; break; }
                            }
                            if (!coords) return;
                            const sev = (r.severity || 'moderate').toUpperCase();
                            L.marker(coords, { icon: reportIcon })
                                .bindPopup(`<b class="text-xs">Commuter delay report</b><br><span class="text-[11px]">${sev}${r.note ? ' — ' + String(r.note).slice(0, 80).replace(/</g, '') : ''}</span>`)
                                .addTo(map);
                        });
                    }
                }
            } catch (e) { /* non-fatal */ }

            // --- DRAW MARKERS (WITH NAKED HALO TOOLTIPS) ---
            Object.entries(globalStations).forEach(([name, data]) => {
                // Important = corridor terminals + designated transfer/relay hubs only
                // (multi-route intermediates like Mayfair stay small)
                const isHub = hubs.has(name);
                const isEnd = ends.has(name);
                const isMajor = isHub || isEnd;

                // GUARDIAN UX: Naked Halo Labeling
                const labelClass = isMajor 
                    ? 'font-bold text-[11px] text-gray-900 dark:text-white z-50 tooltip-dynamic tooltip-halo' 
                    : 'font-medium text-[9.5px] text-gray-700 dark:text-gray-300 tooltip-dynamic tooltip-halo minor-station-tooltip';

                L.circleMarker([data.lat, data.lon], {
                    radius: isMajor ? 5 : 2.5,
                    fillColor: "#ffffff",
                    color: isMajor ? "#1f2937" : "#3b82f6",
                    weight: isMajor ? 2 : 1,
                    opacity: 1,
                    fillOpacity: 1
                }).addTo(map)
                  .bindPopup(`<b class="text-sm">${data.origName.replace(/ STATION/gi, '')}</b>`) 
                  .bindTooltip(data.origName.replace(/ STATION/gi, ''), { 
                      permanent: true, 
                      direction: 'top',
                      offset: [0, -5],
                      className: labelClass
                  });
            });

            // --- BUILD DYNAMIC LEGEND ---
            const legendContent = document.getElementById('legend-content');
            if (legendContent) {
                legendContent.innerHTML = ''; 
                drawnRoutes.forEach(item => {
                    
                    // Evaluate Dynamic Route Status for the Legend
                    let routeStatus = item.isActive ? 'LIVE' : 'DOWN';
                    let badgeColor = item.isActive ? 'bg-green-500' : 'bg-gray-500';

                    let isCritical = false;
                    let isWarning = false;
                    
                    Object.values(globalDisruptions).flat().forEach(d => {
                        if (!d.stations || d.stations.length === 0) {
                            if (d.routeId === item.routeId) {
                                if (d.tier === 'CRITICAL') isCritical = true;
                                else if (d.tier === 'WARNING') isWarning = true;
                            }
                        } else if (d.stations.length >= 1) {
                            const normStations = d.stations.map(s => s.replace(/ STATION/gi, '').trim().toUpperCase());
                            const routeStationNames = item.validStops.map(s => s.name);
                            if (normStations.length >= 2) {
                                if (routeStationNames.includes(normStations[0]) && routeStationNames.includes(normStations[1])) {
                                    if (d.tier === 'CRITICAL') isCritical = true;
                                    else if (d.tier === 'WARNING') isWarning = true;
                                }
                            } else if (normStations.length === 1) {
                                if (routeStationNames.includes(normStations[0])) {
                                    if (d.tier === 'CRITICAL') isCritical = true;
                                    else if (d.tier === 'WARNING') isWarning = true;
                                }
                            }
                        }
                    });

                    if (item.isActive) {
                        if (isCritical) { routeStatus = 'SEVERED'; badgeColor = 'bg-red-500'; } 
                        else if (isWarning) { routeStatus = 'DELAYS'; badgeColor = 'bg-yellow-500'; }
                    } else {
                        // 🛡️ Future Anticipation Badge
                        routeStatus = 'SOON'; 
                        badgeColor = 'bg-blue-600 animate-pulse'; 
                    }

                    legendContent.innerHTML += `
                        <div class="legend-item ${!item.isActive ? 'opacity-80' : ''}">
                            <span class="color-dot" style="background-color: ${item.color}"></span>
                            <span class="text-gray-700 dark:text-gray-200 mr-2">${item.name}</span>
                            <span class="status-badge ${badgeColor}">${routeStatus}</span>
                        </div>
                    `;
                });
            }

            // --- 🛡️ GUARDIAN UX: MAP CONTROLS ---
            // Theme Toggle (compact chrome; zoom +/- removed — pinch / scroll zoom)
            const themeBtn = document.getElementById('custom-theme-btn');
            const themeSunSvg = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
            const themeMoonSvg = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
            let isDarkNow = document.documentElement.classList.contains('dark');
            if (themeBtn) {
                themeBtn.innerHTML = isDarkNow ? themeMoonSvg : themeSunSvg;
                themeBtn.onclick = () => {
                    isDarkNow = !isDarkNow;
                    if (isDarkNow) {
                        document.documentElement.classList.add('dark');
                        try { localStorage.setItem('theme', 'dark'); } catch(e){}
                        themeBtn.innerHTML = themeMoonSvg;
                    } else {
                        document.documentElement.classList.remove('dark');
                        try { localStorage.setItem('theme', 'light'); } catch(e){}
                        themeBtn.innerHTML = themeSunSvg;
                    }
                };
            }

            // 3. Auto-Locate Anti-Rubberband
            let lastKnownLatLng = null;
            let userMarker = null;
            let userRadius = null;
            
            const pulsingIcon = L.divIcon({
                className: 'custom-div-icon',
                html: '<div class="gps-pulse"></div>',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });

            const locateBtn = document.getElementById('custom-locate-btn');
            const locateIcon = locateBtn ? locateBtn.querySelector('svg') : null;

            function applyUserLocation(latlng, accuracy) {
                lastKnownLatLng = latlng;
                const radius = (accuracy || 40) / 2;
                if (!userMarker) {
                    userMarker = L.marker(latlng, {icon: pulsingIcon}).addTo(map)
                        .bindPopup("<div class='text-xs font-bold text-center text-gray-900'>You are here<br><span class='text-[10px] text-gray-500 font-normal'>Within " + Math.round(radius) + " meters</span></div>");
                    userRadius = L.circle(latlng, radius, {
                        color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.15, weight: 1
                    }).addTo(map);
                } else {
                    userMarker.setLatLng(latlng);
                    userRadius.setLatLng(latlng);
                    userRadius.setRadius(radius);
                }
                if (locateIcon) {
                    locateIcon.classList.remove('animate-spin', 'text-gray-400');
                    locateIcon.classList.add('text-blue-600', 'dark:text-blue-400');
                }
                try {
                    if (window.parent && window.parent !== window) {
                        window.parent.postMessage({
                            type: 'nt-map-location',
                            lat: latlng.lat,
                            lng: latlng.lng,
                            accuracy: accuracy || radius * 2
                        }, '*');
                    }
                } catch (_) {}
            }

            map.on('locationfound', function(e) {
                applyUserLocation(e.latlng, e.accuracy);
            });

            map.on('locationerror', function(e) {
                if (locateIcon) {
                    locateIcon.classList.remove('animate-spin', 'text-blue-600', 'dark:text-blue-400');
                    locateIcon.classList.add('text-gray-400');
                }
                if (e.code !== 1) console.warn("Location error:", e.message);
            });

            // Start passive tracking silently without yanking the camera (setView: false)
            map.locate({setView: false, watch: true, enableHighAccuracy: true});

            if (locateBtn) {
                locateBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (lastKnownLatLng) {
                        // Flawless single-camera movement. No rubberbanding!
                        map.flyTo(lastKnownLatLng, 15, { duration: 1.5 });
                    } else {
                        if (locateIcon) locateIcon.classList.add('animate-spin');
                        // Map is already watching, we just wait for locationfound to fire
                    }
                };
            }

            /** Rider markers from the parent Map tab (ride_pings with coarse GPS). */
            let ridePingLayer = null;
            let rideTrainMarkers = {};
            const trainAnim = [];
            function escapePing(s) {
                return String(s || '').replace(/[&<>"']/g, function (c) {
                    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
                });
            }
            function animateTrainMarker(marker, lat, lng, headingDeg, speedMps, expiresAt) {
                const start = Date.now();
                const rad = (headingDeg * Math.PI) / 180;
                function tick() {
                    if (!map.hasLayer(marker)) return;
                    if (Date.now() > (expiresAt || start + 600000)) return;
                    const dt = (Date.now() - start) / 1000;
                    const distM = Math.min(speedMps * dt, 2500);
                    const dLat = (Math.cos(rad) * distM) / 111320;
                    const cosLat = Math.cos((lat * Math.PI) / 180) || 0.7;
                    const dLng = (Math.sin(rad) * distM) / (111320 * cosLat);
                    marker.setLatLng([lat + dLat, lng + dLng]);
                    const id = requestAnimationFrame(tick);
                    trainAnim.push(id);
                }
                trainAnim.push(requestAnimationFrame(tick));
            }
            function renderRidePingMarkers(pings) {
                trainAnim.splice(0).forEach(function (id) { try { cancelAnimationFrame(id); } catch (_) {} });
                if (ridePingLayer) {
                    map.removeLayer(ridePingLayer);
                    ridePingLayer = null;
                }
                if (!pings || !pings.length) return;
                const group = L.layerGroup();
                const trains = {};
                const loose = [];
                rideTrainMarkers = {};
                pings.forEach(function (p) {
                    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
                    if (p.trainId) {
                        const k = String(p.trainId);
                        (trains[k] = trains[k] || []).push(p);
                    } else loose.push(p);
                });

                Object.keys(trains).forEach(function (trainId) {
                    const list = trains[trainId];
                    const lat = list.reduce(function (s, p) { return s + p.lat; }, 0) / list.length;
                    const lng = list.reduce(function (s, p) { return s + p.lng; }, 0) / list.length;
                    const ids = {};
                    list.forEach(function (p) { ids[p.deviceId || (p.lat + ',' + p.lng)] = 1; });
                    const n = Object.keys(ids).length;
                    const speed = (list.find(function (p) { return typeof p.speedMps === 'number'; }) || {}).speedMps || 0;
                    const heading = (list.find(function (p) { return typeof p.heading === 'number'; }) || {}).heading;
                    const icon = L.divIcon({
                        className: 'nt-live-train',
                        html: '<div class="nt-live-train-glyph"><span class="nt-live-train-name">Train '
                            + escapePing(trainId) + '</span><span class="nt-live-train-n">'
                            + n + ' sharing</span></div>',
                        iconSize: [96, 32],
                        iconAnchor: [48, 16]
                    });
                    const marker = L.marker([lat, lng], { icon: icon, zIndexOffset: 800, keyboard: true });
                    const joinId = 'nt-join-train-' + String(trainId).replace(/[^a-zA-Z0-9_-]/g, '');
                    marker.bindPopup(
                        "<div class='text-xs text-gray-900 text-center'>"
                        + "<p class='font-black'>Train " + escapePing(trainId) + "</p>"
                        + "<p class='text-[10px] text-gray-500 mt-0.5'>" + n + " Next Train rider"
                        + (n === 1 ? '' : 's') + " sharing</p>"
                        + "<button type='button' id='" + joinId + "' class='mt-2 w-full py-1.5 rounded-lg bg-blue-600 text-white text-[11px] font-bold'>I’m on this train</button>"
                        + "</div>"
                    );
                    marker.on('popupopen', function () {
                        const btn = document.getElementById(joinId);
                        if (!btn) return;
                        btn.onclick = function () {
                            try {
                                (window.parent || window).postMessage({
                                    type: 'nt-map-join-train',
                                    trainId: trainId,
                                    station: list[0].station || '',
                                    routeId: list[0].routeId || null
                                }, '*');
                            } catch (_) {}
                            map.closePopup();
                        };
                    });
                    marker.addTo(group);
                    rideTrainMarkers[trainId] = marker;
                    if (speed > 1 && typeof heading === 'number') {
                        animateTrainMarker(marker, lat, lng, heading, speed, list[0].expiresAt);
                    }
                });

                loose.forEach(function (p) {
                    const mine = !!p.mine;
                    L.circleMarker([p.lat, p.lng], {
                        radius: mine ? 9 : 8,
                        color: mine ? '#1d4ed8' : '#d97706',
                        weight: 2,
                        fillColor: mine ? '#3b82f6' : '#fbbf24',
                        fillOpacity: 0.85
                    }).bindPopup(
                        "<div class='text-xs font-bold text-center text-gray-900'>"
                        + (mine ? 'You · ' : '') + (p.station || 'Person')
                        + "<br><span class='text-[10px] text-gray-500 font-normal'>visible for 10 min</span></div>"
                    ).addTo(group);
                });
                ridePingLayer = group.addTo(map);
            }

            // Parent Map tab / external nudge (locate + trip contribute markers)
            window.addEventListener('message', function (ev) {
                const data = ev && ev.data;
                if (!data || typeof data !== 'object') return;
                if (data.type === 'nt-map-ride-pings') {
                    renderRidePingMarkers(data.pings || []);
                    return;
                }
                if (data.type === 'nt-map-focus-train' && data.trainId) {
                    const marker = rideTrainMarkers[String(data.trainId)];
                    if (marker) {
                        map.flyTo(marker.getLatLng(), 15, { duration: 1.0 });
                        marker.openPopup();
                    }
                    return;
                }
                if (data.type === 'nt-map-contribute' && typeof data.lat === 'number') {
                    const ll = L.latLng(data.lat, data.lng);
                    applyUserLocation(ll, 40);
                    renderRidePingMarkers([{
                        lat: data.lat, lng: data.lng,
                        trainId: data.trainId, station: data.station
                    }]);
                    map.flyTo(ll, 14, { duration: 1.0 });
                    return;
                }
                if (data.type !== 'nt-map-locate') return;
                if (typeof data.lat === 'number' && typeof data.lng === 'number') {
                    const ll = L.latLng(data.lat, data.lng);
                    applyUserLocation(ll, data.accuracy);
                    map.flyTo(ll, 15, { duration: 1.2 });
                    return;
                }
                if (lastKnownLatLng) map.flyTo(lastKnownLatLng, 15, { duration: 1.2 });
                else if (locateIcon) locateIcon.classList.add('animate-spin');
            });

            // Standalone /map: Share opens parent presence sheet when embedded.
            const shareBtn = document.getElementById('custom-share-location-btn');
            if (shareBtn) {
                shareBtn.onclick = async (e) => {
                    e.stopPropagation();
                    try {
                        if (window.parent && window.parent !== window) {
                            if (typeof window.parent.startPresenceShare === 'function') {
                                window.parent.startPresenceShare({ source: 'map_presence' });
                                return;
                            }
                            if (typeof window.parent.openContributePicker === 'function') {
                                window.parent.openContributePicker();
                                return;
                            }
                            if (typeof window.parent.shareMyLocation === 'function') {
                                await window.parent.shareMyLocation();
                                return;
                            }
                        }
                    } catch (_) {}
                    if (locateIcon) locateIcon.classList.add('animate-spin');
                    map.once('locationfound', function (ev) {
                        applyUserLocation(ev.latlng, ev.accuracy);
                        alert('Open Next Train → Map → Share my location so others can see you for 10 minutes.');
                    });
                    if (!lastKnownLatLng) map.locate({ setView: true, maxZoom: 15, enableHighAccuracy: true });
                    else {
                        alert('Open Next Train → Map → Share my location so others can see you for 10 minutes.');
                    }
                };
            }

            // --- DYNAMIC TEXT RESIZING & PROGRESSIVE DISCLOSURE ---
            function updateTooltipSize() {
                const zoom = map.getZoom();
                const allTooltips = document.querySelectorAll('.tooltip-dynamic');
                const minorTooltips = document.querySelectorAll('.minor-station-tooltip');

                if (zoom < 11) {
                    allTooltips.forEach(t => t.style.opacity = '0');
                } else {
                    allTooltips.forEach(t => t.style.opacity = '1');
                    if (zoom < 13) {
                        minorTooltips.forEach(t => t.style.opacity = '0');
                    }
                }
            }

            map.on('zoomend', updateTooltipSize);
            updateTooltipSize(); 
        }

        function toggleLegend() {
            const wrap = document.getElementById('legend-container');
            const btn = document.getElementById('legend-toggle-btn');
            if (!wrap) return;
            const regionPicker = document.getElementById('region-picker');
            if (regionPicker) {
                regionPicker.classList.remove('is-open');
                document.getElementById('region-toggle-btn')?.setAttribute('aria-expanded', 'false');
            }
            const open = wrap.classList.toggle('is-open');
            if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        window.toggleLegend = toggleLegend;

        // Network Lines starts closed on entry — open via the top-bar button.
    
