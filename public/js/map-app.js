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
            'germ-leralla': ["GERMISTON", "KNIGHTS", "RAVENSKLIP", "ELANDSFONTEIN", "ISANDO", "RHODESFIELD", "KEMPTON PARK", "VAN RIEBEECKPARK", "BIRCHLEIGH", "KAALFONTEIN", "TEMBISA", "LIMINDLELA", "LERALLA"],
            'germ-kwesine': ["GERMISTON", "ELSBURG", "KATLEHONG", "LINDELA", "PILOT", "KWESINE"],
            'jhb-germiston': ["JOHANNESBURG", "DOORNFONTEIN", "ELLIS PARK", "JEPPE", "GEORGE GOCH", "DENVER", "TOORONGA", "CLEVELAND", "GELDENHUIS", "DRIEHOEK", "PRESIDENT", "GERMISTON"],
            'jhb-rand': ["JOHANNESBURG", "BRAAMFONTEIN", "MAYFAIR", "GROSVENOR", "LANGLAAGTE", "MARAISBURG", "UNIFIED", "FLORIDA", "HAMBERG", "GEORGINIA", "ROODEPOORT", "HORISON", "PRINCESS", "WITPOORTJIE", "LUIPAARDSVLEI", "KRUGERSDORP", "WESRAND", "MILLSITE", "ROBINSON", "HOMELAKE", "RANDFONTEIN"],
            'jhb-soweto': ["LANGLAAGTE", "LONGDALE", "NEW CANADA", "MZIMHLOPE", "PHOMOLONG", "PHEFENI", "DUBE", "IKWEZI", "INHLAZANE", "MERAFE", "NALEDI"],
            'jhb-midway': ["JOHANNESBURG", "BRAAMFONTEIN", "MAYFAIR", "GROSVENOR", "LANGLAAGTE", "CROESUS", "LONGDALE", "NEW CANADA", "MLAMLANKUNZI", "ORLANDO", "NANCEFIELD", "KLIPTOWN", "TSHIAWELO", "MIDWAY"],
            
            // --- WESTERN CAPE (GUARDIAN CORRECTED PATHS) ---
            'ct-chrishani': ["CAPE TOWN", "ESPLANADE", "YSTERPLAAT", "MUTUAL", "LANGA", "BONTEHEUWEL", "NETREG", "HEIDEVELD", "NYANGA", "PHILIPPI", "STOCK ROAD", "MANDALAY", "NOLUNGILE", "NONKQUBELA", "KHAYELITSHA", "KUYASA", "CHRIS HANI"],
            'ct-kapteinsklip': ["CAPE TOWN", "WOODSTOCK", "SALT RIVER", "KOEBERG RD", "MAITLAND", "NDABENI", "PINELANDS", "LANGA", "BONTEHEUWEL", "NETREG", "HEIDEVELD", "NYANGA", "PHILIPPI", "LENTEGEUR", "MITCHELL'S PLAIN", "KAPTEINSKLIP"],
            'bellville-mutual': ["BELLVILLE", "SAREPTA", "PENTECH", "UNIBELL", "BELHAR", "LAVISTOWN", "BONTEHEUWEL", "LANGA", "MUTUAL"],
            
            // GUARDIAN: Western Cape Expansion Paths
            'ct-malm': ["CAPE TOWN", "ESPLANADE", "YSTERPLAAT", "CENTURY CITY", "MONTE VISTA", "AVONDALE", "OOSTERZEE", "BELLVILLE", "STIKLAND", "BRACKENFELL", "EIKENFONTEIN", "KRAAIFONTEIN", "FISANTKRAAL", "MELLISH", "MIKPUNT", "KLIPHEUWEL", "WINTEVOGEL", "KALBASKRAAL", "ABBOTSDALE", "MALMESBURY"],
            'ct-flats': ["CAPE TOWN", "WOODSTOCK", "SALT RIVER", "KOEBERG RD", "MAITLAND", "NDABENI", "PINELANDS", "HAZENDAL", "ATHLONE", "CRAWFORD", "LANSDOWNE", "WETTON", "OTTERY", "SOUTHFIELD", "HEATHFIELD", "RETREAT"],
            'ct-nolu': ["CAPE TOWN", "WOODSTOCK", "SALT RIVER", "KOEBERG RD", "MAITLAND", "NDABENI", "PINELANDS", "ESPLANADE", "YSTERPLAAT", "MUTUAL", "LANGA", "BONTEHEUWEL", "NYANGA", "PHILIPPI", "LENTEGEUR", "MITCHELL'S PLAIN", "KAPTEINSKLIP", "STOCK ROAD", "MANDALAY", "NOLUNGILE"],

            // --- KWAZULU-NATAL ---
            'kzn-umlazi': ["DURBAN YARD", "DURBAN", "BEREA ROAD", "DALBRIDGE", "CONGELLA", "UMBILO", "ROSSBURGH", "CLAIRWOOD", "MONTCLAIR", "MEREBANK", "REUNION", "ZWELETHU", "KWAMNYANDU", "LINDOKUHLE", "UMLAZI"],
            'kzn-bridgecity': ["BEREA ROAD", "DURBAN", "MOSES MABHIDA", "UMGENI", "BRIARDENE", "GREENWOOD PARK", "RED HILL", "AVOCA", "TEMPLE", "KENVILLE", "EFFINGHAM", "DUFF'S ROAD", "TEMBALIHLE", "KWAMASHU", "BRIDGE CITY"],
            'kzn-winklespruit': ["DURBAN YARD", "DURBAN", "BEREA ROAD", "DALBRIDGE", "CONGELLA", "UMBILO", "ROSSBURGH", "CLAIRWOOD", "MONTCLAIR", "MEREBANK", "PELGRIM", "ISIPINGO", "UMBOGINTWINI", "PAHLA", "AMANZIMTOTI", "DOONSIDE", "WARNER BEACH", "WINKLESPRUIT"],
            'kzn-catoridge': ["DURBAN YARD", "DURBAN", "BEREA ROAD", "DALBRIDGE", "CONGELLA", "UMBILO", "ROSSBURGH", "MOUNT VERNON", "CAVENDISH", "BURLINGTON", "SHALLCROSS", "KLAARWATER", "MARIANNHILL", "THORNWOOD", "SITUNDU HILLS", "DASSENHOEK", "KWANDENGEZI", "DELVILLE WOOD", "NSHONGWENI", "CLIFFDALE", "HAMMARSDALE", "KWATANDAZA", "GEORGEDALE", "CATO RIDGE"],
            'kzn-pinetown': ["DURBAN YARD", "DURBAN", "BEREA ROAD", "DALBRIDGE", "CONGELLA", "UMBILO", "ROSSBURGH", "SEA VIEW", "BELLAIR", "POET'S CORNER", "MALVERN", "ESCOMBE", "NORTHDENE", "MOSELEY", "GLEN PARK", "SARNIA", "PINETOWN"],
            
            // --- EASTERN CAPE ---
            'ec-berlin': ["EAST LONDON", "SOUTHERNWOOD", "PANMURE", "CHISELHURST", "VINCENT", "CAMBRIDGE", "HIGHGATE", "HORSESHOE", "DAWN", "WILSONIA", "ARNOLDTON", "MTSOTSO", "MDANTSANE", "MOUNT RUTH", "EGERTON", "FORT JACKSON", "LONETREE", "BERLIN"]
        };

        // --- MAP LOGIC (Dynamic Region & DB Sync) ---
        function showMapColdStartPanel(err) {
            console.warn("Guardian: Map Init Failed (cold-start safe).", err);
            const placeholder = document.getElementById('map-placeholder');
            if (placeholder) placeholder.style.display = 'none';
            const panel = document.getElementById('map-cold-start');
            if (panel) panel.classList.remove('hidden');
        }

        function bindMapColdStartControls() {
            const panel = document.getElementById('map-cold-start');
            if (!panel || panel.dataset.bound === '1') return;
            panel.dataset.bound = '1';
            panel.querySelectorAll('[data-region]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const region = btn.getAttribute('data-region') || 'GP';
                    try { localStorage.setItem('userRegion', region); } catch (e) {}
                    window.location.reload();
                });
            });
            document.getElementById('map-retry-btn')?.addEventListener('click', () => window.location.reload());
        }

        window.addEventListener('load', async () => {
            bindMapColdStartControls();
            try {
                // Persist a safe default so brand-new visitors never hit null region crashes
                try {
                    if (!localStorage.getItem('userRegion')) localStorage.setItem('userRegion', 'GP');
                } catch (e) {}

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
                GITHUB: { url: "https://cdn.jsdelivr.net/gh/enock-elk/metrorail-app@main/data/", useRootNode: true },
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

        async function initDynamicMap() {
            if (typeof L === 'undefined') throw new Error("Leaflet Missing");
            if (typeof ROUTES === 'undefined') throw new Error("Config Missing");

            // Guardian: Safe Storage Fetch — default GP for brand-new users
            let currentRegion = 'GP';
            try {
                currentRegion = localStorage.getItem('userRegion') || 'GP';
                if (!localStorage.getItem('userRegion')) localStorage.setItem('userRegion', 'GP');
            } catch(e) {}
            
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
            const voyagerTiles = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
            
            const tileLayer = L.tileLayer(voyagerTiles, {
                attribution: '&copy; OpenStreetMap &copy; CARTO',
                subdomains: 'abcd',
                maxZoom: 19
            }).addTo(map);

            // Fetch Database (local cache → network cold-start)
            const rawDb = await fetchLocalDB(currentRegion);
            if (!rawDb) throw new Error("No Local Database Cached");
            const mergedDb = unwrapDatabase(rawDb, currentRegion);

            // 🛡️ GUARDIAN PHASE 2: Fetch Live Disruptions for Global Map Overlay
            let globalDisruptions = {};
            try {
                const dynamicEndpoint = typeof DYNAMIC_BASE_URL !== 'undefined' ? DYNAMIC_BASE_URL : 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
                const disrResp = await fetch(`${dynamicEndpoint}disruptions.json?t=${Date.now()}`);
                if (disrResp.ok) {
                    const disrData = await disrResp.json();
                    if (disrData) {
                        const now = Date.now();
                        Object.keys(disrData).forEach(routeKey => {
                            const routeObj = disrData[routeKey];
                            if (routeObj && typeof routeObj === 'object') {
                                Object.values(routeObj).forEach(d => {
                                    if (d && (!d.expiresAt || d.expiresAt > now)) {
                                        if (!globalDisruptions[d.routeId]) globalDisruptions[d.routeId] = [];
                                        globalDisruptions[d.routeId].push(d);
                                    }
                                });
                            }
                        });
                    }
                }
            } catch(e) { console.warn("Disruptions fetch failed."); }

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

            // 🛡️ GUARDIAN UX FIX: Empty Map Warning
            if (drawnRoutes.length === 0) {
                const warningBox = document.getElementById('empty-map-warning');
                if (warningBox) warningBox.classList.remove('hidden');
                return; // Stop drawing Leaflet elements
            }

            // --- DRAW BASE ROUTES ---
            drawnRoutes.forEach(r => {
                const isLive = r.isActive;
                L.polyline(r.coords, {
                    color: r.color, // 🛡️ Use actual route color for anticipation
                    weight: isLive ? 4 : 3,
                    opacity: isLive ? 0.9 : 0.35, // Faded for future routes
                    dashArray: isLive ? null : '8, 12', // Distinct dashed look for "Soon"
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

            // --- 🛡️ GUARDIAN PHASE 2: DRAW DYNAMIC DISRUPTION OVERLAYS ---
            const drawnIncidentIds = new Set();
            
            drawnRoutes.forEach(routeObj => {
                Object.values(globalDisruptions).flat().forEach(d => {
                    // Prevent duplicate draws per route-incident pair
                    if (drawnIncidentIds.has(d.id + '_' + routeObj.routeId)) return;
                    
                    const isCritical = d.tier === 'CRITICAL';
                    const color = isCritical ? '#ef4444' : '#eab308';
                    const currentValidStops = routeObj.validStops;
                    const currentPath = routeObj.coords;

                    // No outward pulse rings on incident markers — solid badge only
                    const iconHtml = `<div class="flex items-center justify-center rounded-full shadow-md border-2 border-white" style="width: 22px; height: 22px; background-color: ${color};"><span class="text-[11px] text-white font-black">${isCritical ? '✕' : '!'}</span></div>`;
                    const alertIcon = L.divIcon({ className: 'custom-map-dot z-50', html: iconHtml, iconSize: [22, 22], iconAnchor: [11, 11] });
                    const invisibleIcon = L.divIcon({ className: '', html: '', iconSize: [0,0], iconAnchor: [0,0] });

                    // 1. Route-Wide Disruption
                    if (!d.stations || d.stations.length === 0) {
                        if (d.routeId === routeObj.routeId) {
                            drawnIncidentIds.add(d.id + '_' + routeObj.routeId);
                            L.polyline(currentPath, {
                                color: color, weight: 10, opacity: 0.8, dashArray: '10, 12', lineCap: 'round', lineJoin: 'round', className: 'disruption-line-overlay'
                            }).addTo(map);
                            
                            const startIdx = 0;
                            const endIdx = currentPath.length - 1;
                            
                            L.marker(currentPath[startIdx], { icon: alertIcon }).addTo(map);
                            L.marker(currentPath[endIdx], { icon: alertIcon }).addTo(map);

                            const midIndexExact = (startIdx + endIdx) / 2;
                            let midLat = 0, midLon = 0;
                            if (midIndexExact % 1 === 0) {
                                midLat = currentPath[midIndexExact][0];
                                midLon = currentPath[midIndexExact][1];
                            } else {
                                const f = Math.floor(midIndexExact);
                                const c = Math.ceil(midIndexExact);
                                midLat = (currentPath[f][0] + currentPath[c][0]) / 2;
                                midLon = (currentPath[f][1] + currentPath[c][1]) / 2;
                            }

                            L.marker([midLat, midLon], { icon: invisibleIcon, interactive: false })
                                .bindTooltip(`<b>${isCritical ? 'LINE SEVERED' : 'EXPECT DELAYS'}</b>`, { permanent: true, direction: 'center', className: 'font-bold text-[10px] text-gray-900 z-50 tooltip-dynamic tooltip-halo' })
                                .addTo(map);
                        }
                    } 
                    // 2. Specific Station Disruption (Cross-Corridor Logic)
                    else {
                        const normStations = d.stations.map(s => s.replace(/ STATION/gi, '').trim().toUpperCase());
                        const routeStationNames = currentValidStops.map(s => s.name);
                        
                        // 2A. Segment Blockade (2 stations)
                        if (normStations.length >= 2) {
                            if (routeStationNames.includes(normStations[0]) && routeStationNames.includes(normStations[1])) {
                                const idx1 = routeStationNames.indexOf(normStations[0]);
                                const idx2 = routeStationNames.indexOf(normStations[1]);
                                
                                drawnIncidentIds.add(d.id + '_' + routeObj.routeId);
                                const start = Math.min(idx1, idx2);
                                const end = Math.max(idx1, idx2);
                                const segment = currentPath.slice(start, end + 1);
                                
                                L.polyline(segment, {
                                    color: color, weight: 10, opacity: 0.8, dashArray: '10, 12', lineCap: 'round', lineJoin: 'round', className: 'disruption-line-overlay'
                                }).addTo(map);

                                L.marker(currentPath[start], { icon: alertIcon }).addTo(map);
                                L.marker(currentPath[end], { icon: alertIcon }).addTo(map);

                                const midIndexExact = (start + end) / 2;
                                let midLat = 0, midLon = 0;
                                if (midIndexExact % 1 === 0) {
                                    midLat = currentPath[midIndexExact][0];
                                    midLon = currentPath[midIndexExact][1];
                                } else {
                                    const f = Math.floor(midIndexExact);
                                    const c = Math.ceil(midIndexExact);
                                    midLat = (currentPath[f][0] + currentPath[c][0]) / 2;
                                    midLon = (currentPath[f][1] + currentPath[c][1]) / 2;
                                }

                                L.marker([midLat, midLon], { icon: invisibleIcon, interactive: false })
                                    .bindTooltip(`<b>${isCritical ? 'LINE SEVERED' : 'EXPECT DELAYS'}</b>`, { permanent: true, direction: 'center', className: 'font-bold text-[10px] text-gray-900 z-50 tooltip-dynamic tooltip-halo' })
                                    .addTo(map);
                            }
                        } 
                        // 2B. Single Station Point
                        else if (normStations.length === 1) {
                            if (routeStationNames.includes(normStations[0])) {
                                const idx1 = routeStationNames.indexOf(normStations[0]);
                                drawnIncidentIds.add(d.id + '_' + routeObj.routeId);
                                const s1 = currentValidStops[idx1];
                                
                                L.marker([s1.lat, s1.lon], { icon: alertIcon })
                                    .bindTooltip(`<b>${isCritical ? 'STATION INCIDENT' : 'STATION DELAYS'}</b>`, { permanent: true, direction: 'top', offset: [0, -12], className: 'font-bold text-[10px] text-gray-900 z-50 tooltip-dynamic tooltip-halo' })
                                    .addTo(map);
                            }
                        }
                    }
                });
            });

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

            // --- 🛡️ GUARDIAN UX: HORIZONTAL ACTION BAR WIRING ---
            
            // 1. Zoom Controls
            const zoomInBtn = document.getElementById('custom-zoom-in');
            const zoomOutBtn = document.getElementById('custom-zoom-out');
            if (zoomInBtn) zoomInBtn.onclick = () => map.zoomIn();
            if (zoomOutBtn) zoomOutBtn.onclick = () => map.zoomOut();

            // 2. Theme Toggle
            const themeBtn = document.getElementById('custom-theme-btn');
            let isDarkNow = document.documentElement.classList.contains('dark');
            if (themeBtn) {
                themeBtn.innerHTML = isDarkNow ? '🌙' : '☀️';
                themeBtn.onclick = () => {
                    isDarkNow = !isDarkNow;
                    if (isDarkNow) {
                        document.documentElement.classList.add('dark');
                        try { localStorage.setItem('theme', 'dark'); } catch(e){}
                        themeBtn.innerHTML = '🌙';
                    } else {
                        document.documentElement.classList.remove('dark');
                        try { localStorage.setItem('theme', 'light'); } catch(e){}
                        themeBtn.innerHTML = '☀️';
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

            map.on('locationfound', function(e) {
                lastKnownLatLng = e.latlng;
                const radius = e.accuracy / 2;
                if (!userMarker) {
                    userMarker = L.marker(e.latlng, {icon: pulsingIcon}).addTo(map)
                        .bindPopup("<div class='text-xs font-bold text-center text-gray-900'>You are here<br><span class='text-[10px] text-gray-500 font-normal'>Within " + Math.round(radius) + " meters</span></div>");
                    userRadius = L.circle(e.latlng, radius, {
                        color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.15, weight: 1
                    }).addTo(map);
                } else {
                    userMarker.setLatLng(e.latlng);
                    userRadius.setLatLng(e.latlng);
                    userRadius.setRadius(radius);
                }
                
                if (locateIcon) {
                    locateIcon.classList.remove('animate-spin', 'text-gray-400');
                    locateIcon.classList.add('text-blue-600', 'dark:text-blue-400');
                }
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
            const content = document.getElementById('legend-content');
            const icon = document.getElementById('legend-icon');
            if(content) content.classList.toggle('collapsed');
            if(icon) icon.classList.toggle('rotated');
        }
        window.toggleLegend = toggleLegend;

        // Network Lines starts collapsed on entry (all viewports) — see map.astro markup.
    
