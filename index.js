const puppeteer = require("puppeteer");
const fs = require("fs-extra");
const pc = require("picocolors");
const ObjectsToCsv = require("objects-to-csv");
const { parse } = require('csv-parse');
const { stringify } = require('csv-stringify');
const axios = require('axios');

const processed = new Set();

//SECTION - TOKOPEDIA GET LIST OF STORE BASED ON SEARCH QUERY
const scrapeTokopedia = async (page, keyword, startPage, endPage) => {
    let paginationIndex = 1;
    if (startPage > 1) {
        paginationIndex = startPage;
    }

    for (let index = paginationIndex; index <= endPage; index++) {
        paginationIndex = index;
        let tokopediaSearchUrl = `https://www.tokopedia.com/search?q=${keyword}&st=product&page=${paginationIndex}`;

        await page.goto(tokopediaSearchUrl, {
            waitUntil: "networkidle2",
        });

        await page.waitForSelector(".prd_container-card");
        await autoScroll(page);
        await autoScroll(page);
        await autoScroll(page);

        const productHandles = await page.$$(".prd_container-card");

        const items = [];

        for (const product of productHandles) {
            let shopName, location, tokopediaID,
                tokopediaUrl, Url;

            try {
                shopName = await page.evaluate(
                    (el) => el.querySelector("span.prd_link-shop-name").textContent,
                    product
                );
            } catch {
                shopName = null;
            }
            try {
                location = await page.evaluate(
                    (el) => el.querySelector("span.prd_link-shop-loc").textContent,
                    product
                );
            } catch {
                location = null;
            }

            try {
                Url = await page.evaluate(
                    (el) => el.querySelector("a.pcv3__info-content").getAttribute("href"),
                    product
                );
                const regex = /www\.tokopedia\.com(.+)/;
                const result = regex.exec(Url)[1];
                tokopediaUrl = result.replace(/%2F/g, '/')
                const firstSlashIndex = tokopediaUrl.indexOf("/");
                const secondSlashIndex = tokopediaUrl.indexOf("/", firstSlashIndex + 1);
                const textBetweenSlashes = tokopediaUrl.substring(firstSlashIndex + 1, secondSlashIndex);
                tokopediaID = textBetweenSlashes
            } catch {
                tokopediaUrl = null;
            }


            if (shopName) {
                items.push({ keyword, shopName, location, tokopediaID });
            }
        }

        const csv = new ObjectsToCsv(items);
        await csv.toDisk(`results/${keyword}/tokopedia-search.csv`, { append: true });
    }

    await page.close();
};
const scrapeTokopediaConcurrent = async (keyword, startPage, endPage, concurrency) => {
    const pagesPerConcurrency = Math.ceil((endPage - startPage + 1) / concurrency);
    const pageRanges = [];

    const dir = `results/${keyword}`;
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    for (let i = startPage; i <= endPage; i += pagesPerConcurrency) {
        const end = Math.min(i + pagesPerConcurrency - 1, endPage);
        pageRanges.push([i, end]);
    }
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
    });
    let totalScrapedPages = 0;
    const promises = pageRanges.map(([start, end]) => {
        return (async () => {
            const page = await browser.newPage();

            await scrapeTokopedia(page, keyword, start, end);
            totalScrapedPages += end - start + 1;
            const progress = ((totalScrapedPages / (endPage - startPage + 1)) * 100).toFixed(2);
            console.log(`Scraped ${totalScrapedPages} pages out of ${endPage - startPage + 1} (${pc.green(progress)}% complete)`);
        })();
    });
    await Promise.all(promises);
    await browser.close();
    removeDuplicates(`results/${keyword}/tokopedia-search.csv`, 'tokopediaID');

    const filename = `results/${keyword}/tokopedia-search.csv`;
    readCsvFile(filename)
        .then((items) => {
            runStoreTokopediaConcurrently(items);
        })
        .catch((error) => {
            console.error(error);
        });
};
//!SECTION - TOKOPEDIA GET LIST OF STORE BASED ON SEARCH QUERY


//SECTION - TOKOPEDIA GET STORE DETAIL
const storeTokopedia = async (merchant) => {

    let items = [];
    let products = [];
    let sku = 0;
    let totalStock = 0;
    let TotalProductView = 0;
    let TotalProductTalk = 0;

    //NOTE - fetch data from ShopInfoCore using tokopediaID and get the shopID 
    const response = await fetchShopInfoCore(merchant)
    const shopData = response.data.shopInfoByID.result[0];

    const storeName = shopData.shopCore.name;
    const storeDescription = shopData.shopCore.description;
    const storeDomain = shopData.shopCore.domain;
    const storeID = shopData.shopCore.shopID;
    const storeTagline = shopData.shopCore.tagLine;
    const storeDefaultSort = shopData.shopCore.defaultSort;
    const storeOpenSince = shopData.createInfo.openSince;
    const totalFavorites = shopData.favoriteData.totalFavorite;
    const alreadyFavorited = shopData.favoriteData.alreadyFavorited;
    const activeProductCount = shopData.activeProduct;
    const storeAvatarURL = shopData.shopAssets.avatar;
    const storeCoverURL = shopData.shopAssets.cover;
    const storeLocation = shopData.location;
    const isAllowManage = shopData.isAllowManage;
    const branchLinkDomain = shopData.branchLinkDomain;
    const isOpen = shopData.isOpen;
    const shipmentInfo = shopData.shipmentInfo.map((shipment) => ({
        name: shipment.name,
        isAvailable: shipment.isAvailable,
        image: shipment.image,
        product: shipment.product.map((product) => ({
            productName: product.productName,
            isAvailable: product.isAvailable,
            uiHidden: product.uiHidden,
        })),
    }));
    const shipmentNames = shipmentInfo.map(shipment => shipment.name).join('|');
    const districtName = shopData.shippingLoc.districtName;
    const cityName = shopData.shippingLoc.cityName;
    const totalProductSold = shopData.shopStats.productSold;
    const totalTxSuccess = shopData.shopStats.totalTxSuccess;
    const totalShowcase = shopData.shopStats.totalShowcase;
    const shopStatus = shopData.statusInfo.shopStatus;
    const statusMessage = shopData.statusInfo.statusMessage;
    const statusTitle = shopData.statusInfo.statusTitle;
    const tickerType = shopData.statusInfo.tickerType;
    const closedNote = shopData.closedInfo.closedNote;
    const until = shopData.closedInfo.until;
    const reason = shopData.closedInfo.reason;
    const closedDetailStatus = shopData.closedInfo.detail.status;
    const isGold = shopData.goldOS.isGold;
    const isGoldBadge = shopData.goldOS.isGoldBadge;
    const isOfficial = shopData.goldOS.isOfficial;
    const badgeURL = shopData.goldOS.badge;
    const shopTier = shopData.goldOS.shopTier;
    const shopSnippetURL = shopData.shopSnippetURL;
    const customSEOTitle = shopData.customSEO.title;
    const customSEODescription = shopData.customSEO.description;


    const responsefetchShopStatisticQuery = await fetchShopStatisticQuery(storeID)
    const responsefetchShopStatisticData = responsefetchShopStatisticQuery.data;
    const shopSatisfactionRecentOneMonthbad = responsefetchShopStatisticData.shopSatisfaction.recentOneMonth.bad
    const shopSatisfactionRecentOneMonthgood = responsefetchShopStatisticData.shopSatisfaction.recentOneMonth.good
    const shopSatisfactionRecentOneMonthneutral = responsefetchShopStatisticData.shopSatisfaction.recentOneMonth.neutral

    const shopTotalReviewsRating5 = responsefetchShopStatisticData.shopRating.detail[0].totalReviews
    const shopPercentageRating5 = responsefetchShopStatisticData.shopRating.detail[0].percentage

    const shopTotalReviewsRating4 = responsefetchShopStatisticData.shopRating.detail[1].totalReviews
    const shopPercentageRating4 = responsefetchShopStatisticData.shopRating.detail[1].percentage

    const shopTotalReviewsRating3 = responsefetchShopStatisticData.shopRating.detail[2].totalReviews
    const shopPercentageRating3 = responsefetchShopStatisticData.shopRating.detail[2].percentage

    const shopTotalReviewsRating2 = responsefetchShopStatisticData.shopRating.detail[3].totalReviews
    const shopPercentageRating2 = responsefetchShopStatisticData.shopRating.detail[3].percentage

    const shopTotalReviewsRating1 = responsefetchShopStatisticData.shopRating.detail[4].totalReviews
    const shopPercentageRating1 = responsefetchShopStatisticData.shopRating.detail[4].percentage

    const shopRatingTotalRating = responsefetchShopStatisticData.shopRating.totalRating
    const shopRatingRatingScore = responsefetchShopStatisticData.shopRating.ratingScore

    const shopReputationBadge = responsefetchShopStatisticData.shopReputation[0].badge
    const shopReputationScore = responsefetchShopStatisticData.shopReputation[0].score
    const shopReputationScoreMap = responsefetchShopStatisticData.shopReputation[0].score_map



    let i = 'start'
    let page = 1

    while (i != '') {
        const responseFetchShopProducts = await fetchShopProducts(storeID, page)
        const responseFetchShopProductsData = responseFetchShopProducts.data.GetShopProduct;

        for (let product of responseFetchShopProductsData.data) {
            // Get the last path of the product_url
            const lastPath = product.product_url.split('/').pop().split('?')[0];

            // Remove the query parameter
            const urlWithoutParam = lastPath.split('?')[0];

            // Add the last path to the array
            products.push(urlWithoutParam);
        }

        if (responseFetchShopProducts.data.GetShopProduct.links.next != '') {
            page++
        } else {
            i = ''
        }
    }
    
    // for (const element of products) {
    //     const responseFetchProductDetail = await fetchShopProductDetail(merchant, element)
    //     const responseFetchProductData = responseFetchProductDetail;
    //     sku++
    //     totalStock += parseInt(responseFetchProductData.data.pdpGetLayout.basicInfo.maxOrder)
    //     TotalProductView = parseInt(responseFetchProductData.data.pdpGetLayout.basicInfo.stats.countView)
    //     TotalProductTalk = parseInt(responseFetchProductData.data.pdpGetLayout.basicInfo.stats.countTalk)
    // }



    const row = {
        storeID,
        storeName,
        // storeDescription,
        storeDomain,
        // storeTagline,
        storeDefaultSort,
        storeOpenSince,
        totalFavorites,
        alreadyFavorited,
        activeProductCount,
        storeAvatarURL,
        storeCoverURL,
        storeLocation,
        isAllowManage,
        branchLinkDomain,
        isOpen,
        shipmentNames,
        districtName,
        cityName,
        totalProductSold,
        totalTxSuccess,
        totalShowcase,
        shopStatus,
        statusMessage,
        statusTitle,
        tickerType,
        closedNote,
        until,
        // reason,
        closedDetailStatus,
        isGold,
        isGoldBadge,
        isOfficial,
        badgeURL,
        shopTier,
        shopSnippetURL,
        customSEOTitle,
        // customSEODescription,
        shopSatisfactionRecentOneMonthbad,
        shopSatisfactionRecentOneMonthgood,
        shopSatisfactionRecentOneMonthneutral,
        shopRatingTotalRating,
        shopRatingRatingScore,
        shopReputationBadge,
        shopReputationScore,
        shopReputationScoreMap,
        shopTotalReviewsRating5,
        shopPercentageRating5,
        shopTotalReviewsRating4,
        shopPercentageRating4,
        shopTotalReviewsRating3,
        shopPercentageRating3,
        shopTotalReviewsRating2,
        shopPercentageRating2,
        shopTotalReviewsRating1,
        shopPercentageRating1,
        // sku,
        // totalStock,
        // TotalProductView,
        // TotalProductTalk,
    };

    // // // Add the row object to the items array
    items.push(row);


    // // // Create a new ObjectsToCsv instance with the items array
    const csv = new ObjectsToCsv(items);

    // // // Write the CSV data to disk
    await csv.toDisk('results/tokopedia-store.csv', { append: true });

};

const runStoreTokopediaConcurrently = async (items) => {
    const concurrency = 10;
    let running = 0;
    const queue = [];

    const runTask = async (item) => {
        running++;
        try {
            if (!processed.has(item.tokopediaID)) {
                // do something with the page here, e.g. scrape data, click a button, etc.
                await storeTokopedia(item.tokopediaID);
                processed.add(item.tokopediaID);
            }
        } catch (error) {
            console.error(error);
        }
        running--;
        if (queue.length > 0) {
            const next = queue.shift();
            runTask(next);
        }
    };

    const uniqueItems = Array.from(new Set(items.map(item => item.tokopediaID)))
        .map(id => items.find(item => item.tokopediaID === id));

    for (const item of uniqueItems) {
        if (running < concurrency) {
            runTask(item);
        } else {
            queue.push(item);
        }
    }

    while (running > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
};
//!SECTION - TOKOPEDIA GET STORE DETAIL

//SECTION - Public Function

// remove csv duplicate item
function removeDuplicates(File, column) {
    // Read CSV file
    fs.readFile(File, 'utf8', (err, data) => {
        if (err) throw err;

        // Parse CSV data
        parse(data, { columns: true }, (err, records) => {
            if (err) throw err;

            // Create a new array to hold the non-duplicate records
            const nonDuplicates = [];

            // Create an object to keep track of which values have already been seen
            const seenValues = {};

            // Loop through each record in the input CSV
            for (const record of records) {
                const value = record[column];

                // Check if this value has already been seen
                if (!seenValues[value]) {
                    // Add the record to the non-duplicates array and mark the value as seen
                    nonDuplicates.push(record);
                    seenValues[value] = true;
                }
            }

            // Write the non-duplicates array to a new CSV file
            stringify(nonDuplicates, { header: true }, (err, output) => {
                if (err) throw err;

                fs.writeFile(File, output, (err) => {
                    if (err) throw err;
                    console.log(`Removed duplicates based on column "${column}" and saved to "${File}".`);
                });
            });
        });
    });
}

// scroll page
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            const distance = 1000;
            const intervalTime = 200;
            const scrollHeight = document.body.scrollHeight;

            const scrollStep = () => {
                window.scrollBy(0, distance);
                const { scrollTop } = document.documentElement;

                if (scrollTop + window.innerHeight >= scrollHeight) {
                    resolve();
                    return;
                }

                setTimeout(scrollStep, intervalTime);
            };

            setTimeout(scrollStep, intervalTime);
        });
    });
}

// read csv search result file and convert to object
const readCsvFile = async (filename) => {
    const items = [];
    const csv = require('csv-parser');
    // Read the CSV file
    const stream = fs.createReadStream(filename).pipe(csv());

    // Extract the necessary data
    for await (const row of stream) {
        const { shopName, location, tokopediaID, keyword } = row;
        items.push({ shopName, location, tokopediaID, keyword });
    }

    return items;
};

const fetchShopInfoCore = async (id) => {
    let data = JSON.stringify([
        {
            "operationName": "ShopInfoCore",
            "variables": {
                "id": 0,
                "domain": id
            },
            "query": "query ShopInfoCore($id: Int!, $domain: String) {\n  shopInfoByID(input: {shopIDs: [$id], fields: [\"active_product\", \"allow_manage_all\", \"assets\", \"core\", \"closed_info\", \"create_info\", \"favorite\", \"location\", \"status\", \"is_open\", \"other-goldos\", \"shipment\", \"shopstats\", \"shop-snippet\", \"other-shiploc\", \"shopHomeType\", \"branch-link\", \"goapotik\", \"fs_type\"], domain: $domain, source: \"shoppage\"}) {\n    result {\n      shopCore {\n        description\n        domain\n        shopID\n        name\n        tagLine\n        defaultSort\n        __typename\n      }\n      createInfo {\n        openSince\n        __typename\n      }\n      favoriteData {\n        totalFavorite\n        alreadyFavorited\n        __typename\n      }\n      activeProduct\n      shopAssets {\n        avatar\n        cover\n        __typename\n      }\n      location\n      isAllowManage\n      branchLinkDomain\n      isOpen\n      shipmentInfo {\n        isAvailable\n        image\n        name\n        product {\n          isAvailable\n          productName\n          uiHidden\n          __typename\n        }\n        __typename\n      }\n      shippingLoc {\n        districtName\n        cityName\n        __typename\n      }\n      shopStats {\n        productSold\n        totalTxSuccess\n        totalShowcase\n        __typename\n      }\n      statusInfo {\n        shopStatus\n        statusMessage\n        statusTitle\n        tickerType\n        __typename\n      }\n      closedInfo {\n        closedNote\n        until\n        reason\n        detail {\n          status\n          __typename\n        }\n        __typename\n      }\n      bbInfo {\n        bbName\n        bbDesc\n        bbNameEN\n        bbDescEN\n        __typename\n      }\n      goldOS {\n        isGold\n        isGoldBadge\n        isOfficial\n        badge\n        shopTier\n        __typename\n      }\n      shopSnippetURL\n      customSEO {\n        title\n        description\n        bottomContent\n        __typename\n      }\n      isQA\n      isGoApotik\n      partnerInfo {\n        fsType\n        __typename\n      }\n      epharmacyInfo {\n        siaNumber\n        sipaNumber\n        apj\n        __typename\n      }\n      __typename\n    }\n    error {\n      message\n      __typename\n    }\n    __typename\n  }\n}\n"
        }
    ]);

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'https://gql.tokopedia.com/graphql/ShopInfoCore',
        headers: {
            'authority': 'gql.tokopedia.com',
            'accept': '*/*',
            'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,id;q=0.7',
            'content-type': 'application/json',
            'cookie': 'DID_JS=ZjY2NjBlN2M5ZjM3OTE2ZGZjYzM2ODYwMTlhNDBjNWZiYTJkMmVjODIzMDVhOTNiODMzN2QzNTk3YTBiYTg3OTllMjFiM2JmZDk1ZGZmM2Q4NmM0MGVkNGFlZjUyOTQ547DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=; _UUID_NONLOGIN_=60b32de62c1d54cbabbfe4584ad2df36; _UUID_NONLOGIN_.sig=xySZP8lyMqxGw0kprJ726BZSWL0; DID=346b3f44ad3d6277b4a0f0c12b8d229d4322d73aeb23bd11b61e1f34743612937a35b88c8b54c3380650965b7e0bfd1e; _gcl_au=1.1.2043835506.1681309057; _UUID_CAS_=b72215ac-690a-4db7-b432-a1bbeaffbbd9; _fbp=fb.1.1681309062514.393464149; hfv_banner=true; _gcl_aw=GCL.1681911497.CjwKCAjwov6hBhBsEiwAvrvN6OTALXrUuB81KYMlc6PKvJI9dunqTPO3eZQdUYBWZwGUd35t0JmybRoCSVMQAvD_BwE; _gac_UA-126956641-6=1.1681911497.CjwKCAjwov6hBhBsEiwAvrvN6OTALXrUuB81KYMlc6PKvJI9dunqTPO3eZQdUYBWZwGUd35t0JmybRoCSVMQAvD_BwE; _gac_UA-9801603-1=1.1681911579.CjwKCAjwov6hBhBsEiwAvrvN6OTALXrUuB81KYMlc6PKvJI9dunqTPO3eZQdUYBWZwGUd35t0JmybRoCSVMQAvD_BwE; _SID_Tokopedia_=nAqV4VeMv6Apq4_kplRV7rIUccVDnTy3iFb_46fro1Xq1M9hhlJvh9lQRAvwQgDmuCj50JoTSFjnUEAOgMLLA_hJ_7_ZHVbOZULIcG_ilVeVNds0yoBLwjFgWGgbYIjN; TOPATK=HsMqfEWOStiWssSdXoQEYA; l=1; _hjSessionUser_714968=eyJpZCI6IjRlYmRlOTRjLTQxY2ItNWY4NS05NTg5LTVkZmQ1MzM3YzMzNyIsImNyZWF0ZWQiOjE2ODI0MDM1NTI3NzAsImV4aXN0aW5nIjpmYWxzZX0=; FPF=1; aus=1; _CASE_=2d74321f32746c65676e6e7a74371f32746c626e63636f6762617a743a343a746c7424233b373e762437303a2f763a33253b373837747a74351f32746c64646e7a743a393831746c746767647860646f6167676064616f606664747a743a3722746c747b6e7866656e6560616264626762676f606f747a74261539746c746063676064747a74211f32746c667a74251f32746c67676365666361657a7425022f2633746c74393935747a74213e25746c740d2d0a74213724333e39232533093f320a746c667a0a74253324203f353309222f26330a746c0a74643e0a747a0a740909222f263338373b330a746c0a74013724333e39232533250a742b7a2d0a74213724333e39232533093f320a746c667a0a74253324203f353309222f26330a746c0a7467633b0a747a0a740909222f263338373b330a746c0a74013724333e39232533250a742b0b747a743a032632746c74646664657b66627b64630267656c64656c66657d66616c6666742b; uide=10jBQG/TTgjEQTo1nZYm+hy1Eq/o1qCojk6IjJLfNcPXKycI; tuid=20332305; uidh=6Fe91BVxDcUPWS11AwZ1413YSYsWJy+GtOjmp7k2/I4=; bm_sz=B9B7A0E28B9D049FDB26ACA92B0DE767~YAAQj7jbF4YaoLyHAQAAHLreyxNe2rhQnuA1fOj9eZl3LUXrZafYOJCp0ntz+p9C4nvOv94BAH1ujr/UFbM27/oLXFFY3uYX4FALK5WII9YdjyHscFedEmodBPouu/h7hQvaJWKMWzb2c5D/meyaEt4CPkMHWN7GmKTnEQZ+dZQQOgHzZaYatpUnoM2Az3PyHS1PJS/p0z/lDTT+JZoMUErqBaRhyatFQZbWLLY/D9np7VpRTH2QvqMmdVVeAWJA4AEzsivrDHQORlRsSfuQ9gQwwM6FC25gi/tre6O4eKMWCB7Qx5I=~4469057~4601906; _gid=GA1.2.714630267.1682752587; AMP_TOKEN=%24NOT_FOUND; _abck=25D33F976A63AD9A263872E86A63F9DA~0~YAAQj7jbF5odoLyHAQAADFLgywneE+yDEskZ3Pql91NJfkghuV6pvAwXobrd1NuxhK1mu62vj1M4S/NlRfMp4N61vq6IK23d200pO91ZFSQ4BN+ve/zVbQElMQ97d/JOqDLJPEB9+8MPEaXn46OCksSk+5Hh5HyohZvhQvv8Jr7qSmMyDvfpUlPkHAzUOh+QmYbOEoS3Xcmr1GdPTvVM8ILUc5mg8Qk8oXWyCNHij6oVzIrdIchmidwaP3oLKXRYEXs1BRJVHaYu4cTQX0exoHwbkTXvkolUc8V+BGQBTacO5WXRXqQVWj/LQn0kiqggIcTwslRXME+6Hpln/zlGsyXeiawOJ+iIMmcPsFEOt502XeumBOzqQdPqSm5WdWIJv5REKQyFogSmMNOdKHgL7TO7neU+sCkg/VQ+~-1~-1~-1; ak_bmsc=E1F7C148AC5C30F5A954B88068003F90~000000000000000000000000000000~YAAQj7jbFyUfoLyHAQAAhFDhyxPt3ITM1Chm/DqQZ67zg8vSqpzgkkzrzzbjJGj8yd5oPvBJ/6Arsy0Aem6dZdskGMCfSOF9eKEI2ZUxZK+NdqiEl2/UgRIebkdJ+eziaUhqcm3gU9d8/9qpTXEa/IPe8ghjEB64Yp5L5PvsYf3wbVtViLX0OMVDVvMAFnGwEADQK93CSdoW356+e1fbty4T01WwABcR5MpmPyZ7Nr5UphGONC0O/7BIGy089KkH/GIgc6eC1wHEkl7m64cv/OC9y3lTcFmxDnVPpsS3NJKtY2OLhjv69Uc/jfWRpc8gx1J4mwby1q38EV6Y339Mwm1jFTwRYNFBdUIGpUw1pEib+mDcMhfFBVkks995XnAHwUtKWIugLAFRhyEknWRhz0U3HsD2mZKmEjvInpRt7Uo6nAf+JY/td0Yz7drNI+ChRYHgI3Z47Ux0hX/DalLOBVvHtZm+BOgLS4yzY/GoP8Duc/B6QqPbPOm6Li86kj7jeqjuUOIc70g=; _dc_gtm_UA-126956641-6=1; _dc_gtm_UA-9801603-1=1; webauthn-session=9b7752f2-c30e-4788-925d-97ab96b77702; _ga_70947XW48P=GS1.1.1682752587.16.1.1682752873.50.0.0; _ga=GA1.1.677806521.1681309058; _abck=25D33F976A63AD9A263872E86A63F9DA~-1~YAAQPz7VjBu2XMaHAQAAVZPlywlC+xPYKgGI3BLN6TFMzPLqXd3XY13/8+8lgvcn6uKUGfS2w2zh9CY/90+yUUoj8aYTNXylevBJ8BQY/LWmfjI2m/Zajq+YVSqE/PsQL4jZom1xjfe9YR4WD7B0UziPiCMAJoJcCvCR3/ZxfC3BdmLvFyuU3+2K+A2yFTIdfAvtMJlOdpPYC46UWZuUZGy3kZOu8vDRWanGiL5Tf+nb3emblzzUMFNduPeZxPRNC1ztSa7/kqYvB47l527Wn2ShlxzhHkX+q4L0q0GoOtiF0mBefFRKl8muaj8Gjv58ywpQGc9NZ+2ZaHKjypmPZekhdYZ8GzeO3CHVK8RLJmQ6Gtc6OEXINgPJdwRoFjd+Bss3DSHnP7GEc/t2FzvHiHnu2e6eoc5H4owl~0~-1~-1; bm_sz=6C8D236FE2C626AD8EC97FDFBFC231EF~YAAQPz7VjG56XMaHAQAAq0DeyxNPrYljxR5YdbJI+WCPJz1PMOjS70NOjJ3yKkeW6PmIJ/S0x6qMk71uePrD0fF2Zb9nyqUOQhIEF1F+eLKgZuklBKZMH76/gUW3CTtyr2tQk881LNHPRK94tVAO4Kx75BNkQlkWqIgGc80rrUQXu7XaIo/oQpRWS4iW6L9vE1lo+UHkHiEIEfPGaNqjbcyR0KONbJge6a16vxBSCVhVTbnmwqUjCWRKxXRKPJGOIvN1b2Oy+5YFzVpJx1RvP0Bi1jl6T2hxR/4e4LPPo8iAfxqAzQQ=~3491137~4272450',
            'dnt': '1',
            'origin': 'https://www.tokopedia.com',
            'referer': 'https://www.tokopedia.com/agreshpauthorized',
            'sec-ch-ua': '"Chromium";v="112", "Google Chrome";v="112", "Not:A-Brand";v="99"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"macOS"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36 FirePHP/0.7.4',
            'x-source': 'tokopedia-lite',
            'x-tkpd-lite-service': 'zeus',
            'x-version': 'c620cd1'
        },
        data: data
    };

    try {
        const response = await axios(config);
        return response.data[0];
    } catch (error) {
        console.log(error);
        return null; // return a default value in case of error
    }
}
const fetchShopStatisticQuery = async (id) => {
    const axios = require('axios');
    let data = JSON.stringify([
        {
            "operationName": "ShopStatisticQuery",
            "variables": {
                "shopID": parseInt(id),
                "shopIDStr": id
            },
            "query": "query ShopStatisticQuery($shopID: Int!, $shopIDStr: String!) {\n  shopSatisfaction: ShopSatisfactionQuery(shopId: $shopID) {\n    recentOneMonth {\n      bad\n      good\n      neutral\n      __typename\n    }\n    __typename\n  }\n  shopRating: productrevGetShopRating(shopID: $shopIDStr) {\n    detail {\n      formattedTotalReviews\n      rate\n      percentage\n      percentageFloat\n      totalReviews\n      __typename\n    }\n    totalRating\n    ratingScore\n    __typename\n  }\n  shopReputation: reputation_shops(shop_ids: [$shopID]) {\n    badge\n    score\n    score_map\n    __typename\n  }\n}\n"
        }
    ]);

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'https://gql.tokopedia.com/graphql/ShopStatisticQuery',
        headers: {
            'authority': 'gql.tokopedia.com',
            'accept': '*/*',
            'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,id;q=0.7',
            'content-type': 'application/json',
            'cookie': 'DID_JS=ZjY2NjBlN2M5ZjM3OTE2ZGZjYzM2ODYwMTlhNDBjNWZiYTJkMmVjODIzMDVhOTNiODMzN2QzNTk3YTBiYTg3OTllMjFiM2JmZDk1ZGZmM2Q4NmM0MGVkNGFlZjUyOTQ547DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=; _UUID_NONLOGIN_=60b32de62c1d54cbabbfe4584ad2df36; _UUID_NONLOGIN_.sig=xySZP8lyMqxGw0kprJ726BZSWL0; DID=346b3f44ad3d6277b4a0f0c12b8d229d4322d73aeb23bd11b61e1f34743612937a35b88c8b54c3380650965b7e0bfd1e; _gcl_au=1.1.2043835506.1681309057; _UUID_CAS_=b72215ac-690a-4db7-b432-a1bbeaffbbd9; _fbp=fb.1.1681309062514.393464149; hfv_banner=true; _gcl_aw=GCL.1681911497.CjwKCAjwov6hBhBsEiwAvrvN6OTALXrUuB81KYMlc6PKvJI9dunqTPO3eZQdUYBWZwGUd35t0JmybRoCSVMQAvD_BwE; _gac_UA-126956641-6=1.1681911497.CjwKCAjwov6hBhBsEiwAvrvN6OTALXrUuB81KYMlc6PKvJI9dunqTPO3eZQdUYBWZwGUd35t0JmybRoCSVMQAvD_BwE; _gac_UA-9801603-1=1.1681911579.CjwKCAjwov6hBhBsEiwAvrvN6OTALXrUuB81KYMlc6PKvJI9dunqTPO3eZQdUYBWZwGUd35t0JmybRoCSVMQAvD_BwE; _SID_Tokopedia_=nAqV4VeMv6Apq4_kplRV7rIUccVDnTy3iFb_46fro1Xq1M9hhlJvh9lQRAvwQgDmuCj50JoTSFjnUEAOgMLLA_hJ_7_ZHVbOZULIcG_ilVeVNds0yoBLwjFgWGgbYIjN; TOPATK=HsMqfEWOStiWssSdXoQEYA; l=1; _hjSessionUser_714968=eyJpZCI6IjRlYmRlOTRjLTQxY2ItNWY4NS05NTg5LTVkZmQ1MzM3YzMzNyIsImNyZWF0ZWQiOjE2ODI0MDM1NTI3NzAsImV4aXN0aW5nIjpmYWxzZX0=; FPF=1; aus=1; _CASE_=2d74321f32746c65676e6e7a74371f32746c626e63636f6762617a743a343a746c7424233b373e762437303a2f763a33253b373837747a74351f32746c64646e7a743a393831746c746767647860646f6167676064616f606664747a743a3722746c747b6e7866656e6560616264626762676f606f747a74261539746c746063676064747a74211f32746c667a74251f32746c67676365666361657a7425022f2633746c74393935747a74213e25746c740d2d0a74213724333e39232533093f320a746c667a0a74253324203f353309222f26330a746c0a74643e0a747a0a740909222f263338373b330a746c0a74013724333e39232533250a742b7a2d0a74213724333e39232533093f320a746c667a0a74253324203f353309222f26330a746c0a7467633b0a747a0a740909222f263338373b330a746c0a74013724333e39232533250a742b0b747a743a032632746c74646664657b66627b64630267656c64656c66657d66616c6666742b; uide=10jBQG/TTgjEQTo1nZYm+hy1Eq/o1qCojk6IjJLfNcPXKycI; tuid=20332305; uidh=6Fe91BVxDcUPWS11AwZ1413YSYsWJy+GtOjmp7k2/I4=; bm_sz=B9B7A0E28B9D049FDB26ACA92B0DE767~YAAQj7jbF4YaoLyHAQAAHLreyxNe2rhQnuA1fOj9eZl3LUXrZafYOJCp0ntz+p9C4nvOv94BAH1ujr/UFbM27/oLXFFY3uYX4FALK5WII9YdjyHscFedEmodBPouu/h7hQvaJWKMWzb2c5D/meyaEt4CPkMHWN7GmKTnEQZ+dZQQOgHzZaYatpUnoM2Az3PyHS1PJS/p0z/lDTT+JZoMUErqBaRhyatFQZbWLLY/D9np7VpRTH2QvqMmdVVeAWJA4AEzsivrDHQORlRsSfuQ9gQwwM6FC25gi/tre6O4eKMWCB7Qx5I=~4469057~4601906; _gid=GA1.2.714630267.1682752587; AMP_TOKEN=%24NOT_FOUND; _abck=25D33F976A63AD9A263872E86A63F9DA~0~YAAQj7jbF5odoLyHAQAADFLgywneE+yDEskZ3Pql91NJfkghuV6pvAwXobrd1NuxhK1mu62vj1M4S/NlRfMp4N61vq6IK23d200pO91ZFSQ4BN+ve/zVbQElMQ97d/JOqDLJPEB9+8MPEaXn46OCksSk+5Hh5HyohZvhQvv8Jr7qSmMyDvfpUlPkHAzUOh+QmYbOEoS3Xcmr1GdPTvVM8ILUc5mg8Qk8oXWyCNHij6oVzIrdIchmidwaP3oLKXRYEXs1BRJVHaYu4cTQX0exoHwbkTXvkolUc8V+BGQBTacO5WXRXqQVWj/LQn0kiqggIcTwslRXME+6Hpln/zlGsyXeiawOJ+iIMmcPsFEOt502XeumBOzqQdPqSm5WdWIJv5REKQyFogSmMNOdKHgL7TO7neU+sCkg/VQ+~-1~-1~-1; ak_bmsc=E1F7C148AC5C30F5A954B88068003F90~000000000000000000000000000000~YAAQj7jbFyUfoLyHAQAAhFDhyxPt3ITM1Chm/DqQZ67zg8vSqpzgkkzrzzbjJGj8yd5oPvBJ/6Arsy0Aem6dZdskGMCfSOF9eKEI2ZUxZK+NdqiEl2/UgRIebkdJ+eziaUhqcm3gU9d8/9qpTXEa/IPe8ghjEB64Yp5L5PvsYf3wbVtViLX0OMVDVvMAFnGwEADQK93CSdoW356+e1fbty4T01WwABcR5MpmPyZ7Nr5UphGONC0O/7BIGy089KkH/GIgc6eC1wHEkl7m64cv/OC9y3lTcFmxDnVPpsS3NJKtY2OLhjv69Uc/jfWRpc8gx1J4mwby1q38EV6Y339Mwm1jFTwRYNFBdUIGpUw1pEib+mDcMhfFBVkks995XnAHwUtKWIugLAFRhyEknWRhz0U3HsD2mZKmEjvInpRt7Uo6nAf+JY/td0Yz7drNI+ChRYHgI3Z47Ux0hX/DalLOBVvHtZm+BOgLS4yzY/GoP8Duc/B6QqPbPOm6Li86kj7jeqjuUOIc70g=; _dc_gtm_UA-126956641-6=1; _dc_gtm_UA-9801603-1=1; _ga_70947XW48P=GS1.1.1682752587.16.1.1682752873.50.0.0; _ga=GA1.1.677806521.1681309058; webauthn-session=0c6b7e46-60a7-406e-9ed6-5287d7575e07; _abck=25D33F976A63AD9A263872E86A63F9DA~-1~YAAQDK0wFxF8H8qHAQAA5jX9ywmDZRD8mdthcKNL2NtTf5HiE93WF1oFmzk+um/oJPny17iWwVO0tORBjWuY2oD/6A2VgUClkL9nhfIb6eUr1xdMCsex6bao98H4qlJSS9Cwf4Lg62/wEHi6yIHDwgu2LvPU0PJbXYn6JSA6+KqRMSg1a58kJumOCr0S+hj7KagEoRP7EaJZCB45UAwUVzaUFAh2eY1E0dmb9brBExpSWUSDsMB1PuDZ3BQ5o3Oes1suOEzRBX9lqAf88QsnXTZXRX+h+4JKT/GBhfl1lmDa6tfm144t3SQ0i5stzYOuhQSsy2W21D9zTaGKf74Ylizf9fwMWtj4VaxKFI/gfvmSWWws3JuF4TBYZrzbf5gpvY2o8K2P2Qs5+naJLoSYYoi9gROi500ODJeT~0~-1~-1; bm_sz=6C8D236FE2C626AD8EC97FDFBFC231EF~YAAQPz7VjG56XMaHAQAAq0DeyxNPrYljxR5YdbJI+WCPJz1PMOjS70NOjJ3yKkeW6PmIJ/S0x6qMk71uePrD0fF2Zb9nyqUOQhIEF1F+eLKgZuklBKZMH76/gUW3CTtyr2tQk881LNHPRK94tVAO4Kx75BNkQlkWqIgGc80rrUQXu7XaIo/oQpRWS4iW6L9vE1lo+UHkHiEIEfPGaNqjbcyR0KONbJge6a16vxBSCVhVTbnmwqUjCWRKxXRKPJGOIvN1b2Oy+5YFzVpJx1RvP0Bi1jl6T2hxR/4e4LPPo8iAfxqAzQQ=~3491137~4272450',
            'dnt': '1',
            'origin': 'https://www.tokopedia.com',
            'referer': 'https://www.tokopedia.com/agreshpauthorized',
            'sec-ch-ua': '"Chromium";v="112", "Google Chrome";v="112", "Not:A-Brand";v="99"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"macOS"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36 FirePHP/0.7.4',
            'x-source': 'tokopedia-lite',
            'x-tkpd-lite-service': 'zeus',
            'x-version': 'c620cd1'
        },
        data: data
    };

    try {
        const response = await axios(config);
        return response.data[0];
    } catch (error) {
        console.log(error);
        return null; // return a default value in case of error
    }
}
const fetchShopProducts = async (id, page) => {
    const axios = require('axios');
    let data = JSON.stringify([
        {
            "operationName": "ShopProducts",
            "variables": {
                "sid": id,
                "page": page,
                "perPage": 100,
                "etalaseId": "etalase",
                "sort": 1,
                "user_districtId": "3188",
                "user_cityId": "228",
                "user_lat": "-8.038367424141969",
                "user_long": "112.6297116279602"
            },
            "query": "query ShopProducts($sid: String!, $page: Int, $perPage: Int, $keyword: String, $etalaseId: String, $sort: Int, $user_districtId: String, $user_cityId: String, $user_lat: String, $user_long: String) {\n  GetShopProduct(shopID: $sid, filter: {page: $page, perPage: $perPage, fkeyword: $keyword, fmenu: $etalaseId, sort: $sort, user_districtId: $user_districtId, user_cityId: $user_cityId, user_lat: $user_lat, user_long: $user_long}) {\n    status\n    errors\n    links {\n      prev\n      next\n      __typename\n    }\n    data {\n      name\n      product_url\n      product_id\n      price {\n        text_idr\n        __typename\n      }\n      primary_image {\n        original\n        thumbnail\n        resize300\n        __typename\n      }\n      flags {\n        isSold\n        isPreorder\n        isWholesale\n        isWishlist\n        __typename\n      }\n      campaign {\n        discounted_percentage\n        original_price_fmt\n        start_date\n        end_date\n        __typename\n      }\n      label {\n        color_hex\n        content\n        __typename\n      }\n      label_groups {\n        position\n        title\n        type\n        url\n        __typename\n      }\n      badge {\n        title\n        image_url\n        __typename\n      }\n      stats {\n        reviewCount\n        rating\n        averageRating\n        __typename\n      }\n      category {\n        id\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n"
        }
    ]);

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'https://gql.tokopedia.com/graphql/ShopProducts',
        headers: {
            'authority': 'gql.tokopedia.com',
            'accept': '*/*',
            'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,id;q=0.7',
            'content-type': 'application/json',
            'dnt': '1',
            'origin': 'https://www.tokopedia.com',
            'referer': 'https://www.tokopedia.com/periplus/product/page/3',
            'sec-ch-ua': '"Chromium";v="112", "Google Chrome";v="112", "Not:A-Brand";v="99"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"macOS"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36 FirePHP/0.7.4',
            'x-device': 'default_v3',
            'x-source': 'tokopedia-lite',
            'x-tkpd-lite-service': 'zeus',
            'x-version': 'c620cd1',
            'Cookie': '_abck=25D33F976A63AD9A263872E86A63F9DA~-1~YAAQZ3Fidg9UgcyHAQAAWX3YzQlsVuM79tXShp4GN9kSzI8z5x/fKmJw1r44Bt8OCCG78eBBCG+CnIMyzjPEgE5eoDzylNmW3nATWGGgXRCqINACJHOBa3noYoFhQJfalfvNAvvD4ox/sGUAoCuc9zpEavC4DcIBnsEl80lofMwFCY1CDyDoTwWXxoPGcrO8Ham26YC79ysqpx5nq0FXXzvECtyvCui6mJA56dTwjmUBfiRfws696WqHsfGtX/I0t3kntiz4YhOLRb2t/Jefk/HtUO+jfCzo6SqcIw/EA7wslziN0Z+OVFqINGQIH569UbR4MwTlcZt2KmblXYOi5a9i+p4Syn3UDwu0Rzq8U/lxFMJJP++8IRD8YysEVMojvgDm/LZBmKcM/3u6Rb7GBYXJRyRzVXK7eytSVQ==~-1~-1~-1; bm_sz=AC81C3D3C42CBDA728FDB6FC65703EF9~YAAQZ3FidhBUgcyHAQAAWX3YzRORmlrjM3vbUvOP6VkU5czBiyu0RhDnlnyXoZXcG9u5V51z2DV5bhjMVrB80CBjw1+CuWLxTYp/d+vj/Uu1AxHpl7DcMKUd1940cCri0meshcJsNPUDGm/OB4n7jUa5vtK2S/oXvZPx2hxsu/r42TXqzsV7XETp8Kl3WtP5/soSCgyM+6iu4CtoS3syYfgOdr8VLIwuMpCQ6+uQSRcPzlrsXfZd3xE+c5Q/kbKAkHFYhAZwEKCtF+Cu1WcCblF+zQSfjvMo3+qdtBz7v+bMjHPTTpY=~4474423~4337970'
        },
        data: data
    };

    try {
        const response = await axios(config);
        return response.data[0];
    } catch (error) {
        console.log(error);
        return null; // return a default value in case of error
    }
}

const fetchShopProductDetail = async (id, productKey) => {
    console.log(id, productKey);
    const axios = require('axios');
    let data = JSON.stringify([
        {
            "operationName": "PDPGetLayoutQuery",
            "variables": {
                "shopDomain": id,
                "productKey": productKey,
                "layoutID": "",
                "apiVersion": 1,
                "userLocation": {
                    "cityID": "228"
                },
                "extParam": ""
            },
            "query": "query PDPGetLayoutQuery($shopDomain: String, $productKey: String, $layoutID: String, $apiVersion: Float, $userLocation: pdpUserLocation, $extParam: String) {\n  pdpGetLayout(shopDomain: $shopDomain, productKey: $productKey, layoutID: $layoutID, apiVersion: $apiVersion, userLocation: $userLocation, extParam: $extParam) {\n     basicInfo {\n      maxOrder\n txStats {\n        transactionSuccess\n        transactionReject\n        countSold\n        paymentVerified\n        itemSoldFmt\n        __typename\n      }\n      stats {\n        countView\n        countReview\n        countTalk\n        rating\n        __typename\n      }\n      __typename\n    }\n        __typename\n  }\n}\n"
        }
    ]);

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'https://gql.tokopedia.com/graphql/PDPGetLayoutQuery',
        headers: {
            'authority': 'gql.tokopedia.com',
            'accept': '*/*',
            'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,id;q=0.7',
            'content-type': 'application/json',
            'cookie': 'DID_JS=ZjY2NjBlN2M5ZjM3OTE2ZGZjYzM2ODYwMTlhNDBjNWZiYTJkMmVjODIzMDVhOTNiODMzN2QzNTk3YTBiYTg3OTllMjFiM2JmZDk1ZGZmM2Q4NmM0MGVkNGFlZjUyOTQ547DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=; _UUID_NONLOGIN_=60b32de62c1d54cbabbfe4584ad2df36; _UUID_NONLOGIN_.sig=xySZP8lyMqxGw0kprJ726BZSWL0; DID=346b3f44ad3d6277b4a0f0c12b8d229d4322d73aeb23bd11b61e1f34743612937a35b88c8b54c3380650965b7e0bfd1e; _gcl_au=1.1.2043835506.1681309057; _UUID_CAS_=b72215ac-690a-4db7-b432-a1bbeaffbbd9; _fbp=fb.1.1681309062514.393464149; hfv_banner=true; _gcl_aw=GCL.1681911497.CjwKCAjwov6hBhBsEiwAvrvN6OTALXrUuB81KYMlc6PKvJI9dunqTPO3eZQdUYBWZwGUd35t0JmybRoCSVMQAvD_BwE; _gac_UA-126956641-6=1.1681911497.CjwKCAjwov6hBhBsEiwAvrvN6OTALXrUuB81KYMlc6PKvJI9dunqTPO3eZQdUYBWZwGUd35t0JmybRoCSVMQAvD_BwE; _gac_UA-9801603-1=1.1681911579.CjwKCAjwov6hBhBsEiwAvrvN6OTALXrUuB81KYMlc6PKvJI9dunqTPO3eZQdUYBWZwGUd35t0JmybRoCSVMQAvD_BwE; _SID_Tokopedia_=nAqV4VeMv6Apq4_kplRV7rIUccVDnTy3iFb_46fro1Xq1M9hhlJvh9lQRAvwQgDmuCj50JoTSFjnUEAOgMLLA_hJ_7_ZHVbOZULIcG_ilVeVNds0yoBLwjFgWGgbYIjN; TOPATK=HsMqfEWOStiWssSdXoQEYA; l=1; _hjSessionUser_714968=eyJpZCI6IjRlYmRlOTRjLTQxY2ItNWY4NS05NTg5LTVkZmQ1MzM3YzMzNyIsImNyZWF0ZWQiOjE2ODI0MDM1NTI3NzAsImV4aXN0aW5nIjpmYWxzZX0=; FPF=1; aus=1; _CASE_=2d74321f32746c65676e6e7a74371f32746c626e63636f6762617a743a343a746c7424233b373e762437303a2f763a33253b373837747a74351f32746c64646e7a743a393831746c746767647860646f6167676064616f606664747a743a3722746c747b6e7866656e6560616264626762676f606f747a74261539746c746063676064747a74211f32746c667a74251f32746c67676365666361657a7425022f2633746c74393935747a74213e25746c740d2d0a74213724333e39232533093f320a746c667a0a74253324203f353309222f26330a746c0a74643e0a747a0a740909222f263338373b330a746c0a74013724333e39232533250a742b7a2d0a74213724333e39232533093f320a746c667a0a74253324203f353309222f26330a746c0a7467633b0a747a0a740909222f263338373b330a746c0a74013724333e39232533250a742b0b747a743a032632746c74646664657b66627b64630267656c64656c66657d66616c6666742b; uide=10jBQG/TTgjEQTo1nZYm+hy1Eq/o1qCojk6IjJLfNcPXKycI; tuid=20332305; uidh=6Fe91BVxDcUPWS11AwZ1413YSYsWJy+GtOjmp7k2/I4=; _gid=GA1.2.714630267.1682752587; bm_sz=3E2107A999E8AB97BD2417855EB6765C~YAAQZ3Fidq8xg8yHAQAAr1vczxPRQuhY0xcMdWE1bMEmGw/b0/9cr+fQpHUV2t+BqujU1ZDtOCXk18Bl2CeAILQ1o1NlxkCMc2+r42O0mPs7SCBMK3AhVfsUGCexBnKSNvwyYV3I2XLb8aKGdS3HwCGWcXE+x7BrzkQBuPk3+jsFz+u96PWSeiHqmbT39nCzm7C5SLVumKteKj2CXNlLNPCXUa6hCpc4rY7J8GcJaHx9eYwlEuQUoeUm5kBBYqJwoh9/VtPVRQaHnT5P6D7zU1fJ+ktFHbk6XiJ0E9dMKRJjizs18JY=~4469047~4604467; ak_bmsc=C98A8D12192CA33F2C6396BBD7C4CD30~000000000000000000000000000000~YAAQZ3FidoYyg8yHAQAAMKbczxPwsMNQe2Lo6OjFjW3WZN23CLKZbb//ffHmIRrnbkHON1xifdzevaCqOOV57dTaHMMAZKzjIztiszX6zOzJArNIKtqC6nrUjWNJG35f09FfOixVQbNcE0bZZzd5/liRVvglzasd9uOwc5hGSDQocPPlDAfas5jbOBQeQjawSH05qVYxVbtE+6P0oy7VyBDANQ3hNQdsd24QD8Otod3m3Pg0h6P3/RrZEpnAH7cMNVRnD/76zj/VujIg9RBM+VT28DAUVcsduIEu91enGoTAH/nAYhXv+kZHPyLIj9lEXFiV4mkann4M70CXQMy6VBbJ+MFIjgwt0L788jSQWFLlH7ekf5S48+dWk8kuvRySnEN3x8C0vB+yQLvv6EpnZpnj9d1egCR9jhLdsV01rRrxXw1VsMfcwps2lCbtPy3aD45hS2t9qAaNl+YiQGTmVBSAP8ZO78kn+OdEpIRDBZFgMwlVENacj/uAEBi8f9JlBfs3yQ5/uyHq; AMP_TOKEN=%24NOT_FOUND; _gat_UA-9801603-1=1; _dc_gtm_UA-9801603-1=1; webauthn-session=86284c0e-e924-447b-b752-25e78bcb3f61; _dc_gtm_UA-126956641-6=1; _ga=GA1.2.677806521.1681309058; _ga_70947XW48P=GS1.1.1682819543.18.1.1682820546.39.0.0; _abck=25D33F976A63AD9A263872E86A63F9DA~0~YAAQL3Fids9sI7uHAQAArMLrzwkFfvpMqt982JJYWDttP/eRthXZLJgeC+FbV8Nw+3GoFOcazCd/xUZqVk8zKq8z6CDsoodM1WMbcl1PephEpjyQPibKrgKqoX9IxMaY+Eb87FipK5jyO54mik7DiUfuNAdoOwrYGQz0aD8Dptc608du6OAXG27kkyBJvperVhNMsaEnuBi/yWAsOnKLGx56QH8NV22FTYbhlVtpthA7xp5y1SZLrlXxilSWP5E/cFGSmtKfeYs1V9ZEYdeRVUC+lHzUAeT/SVNpiMMWsFY6yodtg8flBvEq9nIXU6IhaSvmUQ/vC7Y0EbY9wvGx7KxhnlK344RbaXoEVK0FHsf0Kg0k2SAo9qyi0i8uloj0NsVs4EUBA6uXYm5KLM0xWiKTuom5OvjOUVCM~-1~-1~-1; _abck=25D33F976A63AD9A263872E86A63F9DA~-1~YAAQPD7VjE1QBaCHAQAAgfI90An/7eFve45qAPcAHTtMUY0rpTE2oi58Fdhcjr+ifnvNao2AvZ85crT9K27kq54T/gdpyDZ1LuYTs3g/eUzHBHa0OtND0XjKTAWFp5ZQBj9ekra6Dd/7PtU8aLHWrUJsooVCBKil9JXLCe2hu29Aw3PnyH7r1sAfPfxo2rMujClRR80OcnbABapnDGmciJBbQ5GH94se17M93nCbAUXIWi54cv1GggWdeWLHeMLB4Ml08TK2kXtH8R9XgoHneCQ9lqLaM4hEfiQqX7GRg0EvtaZbmMSv+edflrm9gB4DNlo83tWWATWFwBIwftyDNXRyN44repSCLe4JQmQ4XM6az1c+yVMNn2ez5tyHglWpqQla4wCBBJb6bXH5np8tJMR9eKzt8Sl9Ntc8~0~-1~-1; bm_sz=48EC14070657B9E42A8F1CFA1F0F4B7B~YAAQL3FidiGXI7uHAQAAMYnyzxPoWpw5DtzaRaIkOhxJb720uxhkf8ibo6Sau+nir/hbLybrdymGnaZIb6G6FlUURzngEZALgFhpCEvsz/Z4XBc5Y2tofCYdO9mjb9WW7J7yzKq/3DOtllw9CZ0lq5LgxZLAbZpI5h/VgxZ05E3+RkJ4loCF2eE1DZdRexVnEfAfy0holssJyFkp1XcsaTRVFgw3npsOJt68qGQwHWL3EkO6i/SmkMzoskZp6wZl8r15PWNkPdNMgyVvpZ8LXJPuvLAk2ULP3/GvW4Z0KCUaCjdUNYU=~3682865~3359799',
            'dnt': '1',
            'origin': 'https://www.tokopedia.com',
            'referer': 'https://www.tokopedia.com/starco/starco-laptop-stand-tablet-stand-holder-dudukan-laptop-meja-laptop-putih?src=topads',
            'sec-ch-ua': '"Chromium";v="112", "Google Chrome";v="112", "Not:A-Brand";v="99"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"macOS"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36 FirePHP/0.7.4',
            'x-device': 'desktop',
            'x-source': 'tokopedia-lite',
            'x-tkpd-akamai': 'pdpGetLayout',
            'x-tkpd-lite-service': 'zeus',
            'x-version': 'c620cd1'
        },
        data: data
    };


    try {
        const response = await axios(config);
        return response.data[0];
    } catch (error) {
        return null; // return a default value in case of error
    }
}

//!SECTION - Public Function


//SECTION - start

/**
 * call scrapeTokopediaConcurrent to start scraping data
 *
 *
 * args 1 - keyword target (string)
 * args 2 - start page (int)
 * args 3 - end page (int)
 * args 4 - batching limit
 */
// scrapeTokopediaConcurrent(process.argv[2], 1, 20, 5);

const filename = `results/skincare/tokopedia-search.csv`;
readCsvFile(filename)
    .then((items) => {
        runStoreTokopediaConcurrently(items);
    })
    .catch((error) => {
        console.error(error);
    });
//!SECTION -Start

