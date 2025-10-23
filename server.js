const express = require('express');
const axios = require('axios');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

const FINHUB_API_KEY = process.env.FINHUB_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;

if (!FINHUB_API_KEY) {
    console.error('ERROR: FINHUB_API_KEY is not set in .env file');
    process.exit(1);
}

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;

        if (!q || q.trim().length === 0) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        const response = await axios.get('https://finnhub.io/api/v1/search', {
            params: {
                q: q.trim(),
                token: FINHUB_API_KEY
            },
            timeout: 10000,
        });

        const results = (response.data.result || [])
            .filter(stock => stock.symbol && stock.description)
            .slice(0, 20)
            .map(stock => ({
                symbol: stock.symbol,
                description: stock.description,
                type: stock.type || 'Unknown',
                displaySymbol: stock.displaySymbol || stock.symbol
            }));

        res.json({
            count: results.length,
            results: results
        });

    } catch (error) {
        console.error('Error searching stocks:', error.message);
        res.status(500).json({
            error: 'Failed to search stocks',
            message: error.message
        });
    }
});

app.get('/api/stock/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const response = await axios.get('https://finnhub.io/api/v1/quote', {
            params: {
                symbol: symbol,
                token: FINHUB_API_KEY
            },
            timeout: 10000,
        });

        if (response.data.c === 0 && response.data.h === 0 && response.data.l === 0) {
            return res.status(404).json({ error: 'Stock not found or market closed' });
        }

        res.json(response.data);
    } catch (error) {
        console.error('Error fetching stock data:', error.message);

        // Handle 403 forbidden errors (API doesn't support this symbol/exchange)
        if (error.response && error.response.status === 403) {
            return res.status(403).json({
                error: 'Stock data not available',
                message: 'This stock exchange or symbol is not supported by the API. Try US stocks (e.g., AAPL) or Indian NSE stocks (e.g., RELIANCE.NS)',
                symbol: req.params.symbol
            });
        }

        res.status(500).json({
            error: 'Failed to fetch stock data',
            message: error.message
        });
    }
});

app.get('/api/company/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const response = await axios.get('https://finnhub.io/api/v1/stock/profile2', {
            params: {
                symbol: symbol,
                token: FINHUB_API_KEY
            },
            timeout: 10000,
        });

        if (!response.data || Object.keys(response.data).length === 0) {
            return res.status(404).json({ error: 'Company profile not found' });
        }

        res.json(response.data);
    } catch (error) {
        console.error('Error fetching company profile:', error.message);

        // Handle 403 forbidden errors
        if (error.response && error.response.status === 403) {
            return res.status(403).json({
                error: 'Company profile not available',
                message: 'This stock exchange or symbol is not supported by the API. Try US stocks or Indian NSE stocks (.NS suffix)',
                symbol: req.params.symbol
            });
        }

        res.status(500).json({
            error: 'Failed to fetch company profile',
            message: error.message
        });
    }
});

app.get('/api/candles/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const { resolution, from, to } = req.query;

        if (!resolution || !from || !to) {
            return res.status(400).json({ error: 'Missing required parameters: resolution, from, to' });
        }

        const response = await axios.get('https://finnhub.io/api/v1/stock/candle', {
            params: {
                symbol: symbol,
                resolution: resolution,
                from: from,
                to: to,
                token: FINHUB_API_KEY
            },
            timeout: 15000,
        });

        if (response.data.s === 'no_data') {
            return res.status(404).json({ error: 'No data available for this symbol and time range' });
        }

        res.json(response.data);
    } catch (error) {
        console.error('Error fetching candles data:', error.message);

        // Handle 403 forbidden - Finnhub free tier doesn't support candles
        // Return mock data so the chart still displays
        if (error.response && error.response.status === 403) {
            const { symbol } = req.params;
            const { from, to } = req.query;
            console.log(`Generating mock candle data for ${symbol} (API limitation)`);

            // Get current price to generate realistic mock data
            try {
                const quoteRes = await axios.get('https://finnhub.io/api/v1/quote', {
                    params: { symbol, token: FINHUB_API_KEY },
                    timeout: 10000
                });

                const currentPrice = quoteRes.data.c || 100;
                const mockData = generateMockCandles(currentPrice, parseInt(from), parseInt(to));
                return res.json(mockData);
            } catch (quoteError) {
                // If even quote fails, use generic mock data
                const mockData = generateMockCandles(100, parseInt(from), parseInt(to));
                return res.json(mockData);
            }
        }

        res.status(500).json({
            error: 'Failed to fetch candles data',
            message: error.message
        });
    }
});

// Generate mock candle data for visualization when API doesn't support it
function generateMockCandles(basePrice, fromTimestamp, toTimestamp) {
    const timestamps = [];
    const opens = [];
    const highs = [];
    const lows = [];
    const closes = [];
    const volumes = [];

    const daysCount = Math.min(Math.floor((toTimestamp - fromTimestamp) / 86400), 30); // Max 30 days
    let currentPrice = basePrice;

    for (let i = 0; i < daysCount; i++) {
        const timestamp = fromTimestamp + (i * 86400);
        timestamps.push(timestamp);

        // Generate realistic price movement (±3% daily variation)
        const dailyChange = (Math.random() - 0.5) * 0.06; // -3% to +3%
        const open = currentPrice;
        const close = currentPrice * (1 + dailyChange);
        const high = Math.max(open, close) * (1 + Math.random() * 0.02);
        const low = Math.min(open, close) * (1 - Math.random() * 0.02);
        const volume = Math.floor(1000000 + Math.random() * 5000000);

        opens.push(parseFloat(open.toFixed(2)));
        closes.push(parseFloat(close.toFixed(2)));
        highs.push(parseFloat(high.toFixed(2)));
        lows.push(parseFloat(low.toFixed(2)));
        volumes.push(volume);

        currentPrice = close;
    }

    return {
        s: 'ok',
        t: timestamps,
        o: opens,
        h: highs,
        l: lows,
        c: closes,
        v: volumes,
        _mock: true // Flag to indicate this is mock data
    };
}

app.get('/api/crypto/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const cryptoSymbol = `BINANCE:${symbol}USDT`;

        const response = await axios.get('https://finnhub.io/api/v1/quote', {
            params: {
                symbol: cryptoSymbol,
                token: FINHUB_API_KEY
            },
            timeout: 10000,
        });

        if (response.data.c === 0 && response.data.h === 0 && response.data.l === 0) {
            return res.status(404).json({ error: 'Crypto not found' });
        }

        res.json(response.data);
    } catch (error) {
        console.error('Error fetching crypto data:', error.message);
        res.status(500).json({
            error: 'Failed to fetch crypto data',
            message: error.message
        });
    }
});

// Get top cryptocurrencies list
app.get('/api/crypto-list', async (req, res) => {
    try {
        // List of popular cryptocurrencies
        const topCryptos = [
            { symbol: 'BTC', name: 'Bitcoin', icon: '₿' },
            { symbol: 'ETH', name: 'Ethereum', icon: 'Ξ' },
            { symbol: 'USDT', name: 'Tether', icon: '₮' },
            { symbol: 'BNB', name: 'Binance Coin', icon: 'BNB' },
            { symbol: 'SOL', name: 'Solana', icon: 'SOL' },
            { symbol: 'XRP', name: 'Ripple', icon: 'XRP' },
            { symbol: 'ADA', name: 'Cardano', icon: '₳' },
            { symbol: 'DOGE', name: 'Dogecoin', icon: 'Ð' },
            { symbol: 'AVAX', name: 'Avalanche', icon: 'AVAX' },
            { symbol: 'MATIC', name: 'Polygon', icon: 'MATIC' },
            { symbol: 'DOT', name: 'Polkadot', icon: 'DOT' },
            { symbol: 'SHIB', name: 'Shiba Inu', icon: 'SHIB' },
            { symbol: 'LTC', name: 'Litecoin', icon: 'Ł' },
            { symbol: 'TRX', name: 'TRON', icon: 'TRX' },
            { symbol: 'LINK', name: 'Chainlink', icon: 'LINK' }
        ];

        // Fetch prices for all cryptos in parallel
        const promises = topCryptos.map(async (crypto) => {
            try {
                const response = await axios.get('https://finnhub.io/api/v1/quote', {
                    params: {
                        symbol: `BINANCE:${crypto.symbol}USDT`,
                        token: FINHUB_API_KEY
                    },
                    timeout: 5000,
                });

                return {
                    ...crypto,
                    price: response.data.c || 0,
                    change: response.data.d || 0,
                    changePercent: response.data.dp || 0,
                    high: response.data.h || 0,
                    low: response.data.l || 0,
                    open: response.data.o || 0,
                    previousClose: response.data.pc || 0
                };
            } catch (error) {
                console.error(`Error fetching ${crypto.symbol}:`, error.message);
                return {
                    ...crypto,
                    price: 0,
                    change: 0,
                    changePercent: 0,
                    error: 'Failed to fetch'
                };
            }
        });

        const cryptoData = await Promise.all(promises);

        // Filter out failed requests and sort by market cap (price as proxy)
        const validCryptos = cryptoData
            .filter(c => c.price > 0)
            .sort((a, b) => {
                // Keep original order (already sorted by market cap)
                return 0;
            });

        res.json({
            count: validCryptos.length,
            cryptos: validCryptos,
            lastUpdated: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching crypto list:', error.message);
        res.status(500).json({
            error: 'Failed to fetch crypto list',
            message: error.message
        });
    }
});

// Get crypto candles/historical data
app.get('/api/crypto-candles/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const { resolution, from, to } = req.query;
        const cryptoSymbol = `BINANCE:${symbol}USDT`;

        if (!resolution || !from || !to) {
            return res.status(400).json({ error: 'Missing required parameters: resolution, from, to' });
        }

        const response = await axios.get('https://finnhub.io/api/v1/crypto/candle', {
            params: {
                symbol: cryptoSymbol,
                resolution: resolution,
                from: from,
                to: to,
                token: FINHUB_API_KEY
            },
            timeout: 15000,
        });

        if (response.data.s === 'no_data') {
            // Generate mock data for crypto too
            const quoteRes = await axios.get('https://finnhub.io/api/v1/quote', {
                params: { symbol: cryptoSymbol, token: FINHUB_API_KEY },
                timeout: 10000
            });
            const currentPrice = quoteRes.data.c || 100;
            const mockData = generateMockCandles(currentPrice, parseInt(from), parseInt(to));
            return res.json(mockData);
        }

        res.json(response.data);
    } catch (error) {
        console.error('Error fetching crypto candles:', error.message);

        // Fallback to mock data on error
        if (error.response && (error.response.status === 403 || error.response.status === 404)) {
            try {
                const { symbol } = req.params;
                const { from, to } = req.query;
                const cryptoSymbol = `BINANCE:${symbol}USDT`;

                const quoteRes = await axios.get('https://finnhub.io/api/v1/quote', {
                    params: { symbol: cryptoSymbol, token: FINHUB_API_KEY },
                    timeout: 10000
                });

                const currentPrice = quoteRes.data.c || 100;
                const mockData = generateMockCandles(currentPrice, parseInt(from), parseInt(to));
                return res.json(mockData);
            } catch (quoteError) {
                const mockData = generateMockCandles(100, parseInt(req.query.from), parseInt(req.query.to));
                return res.json(mockData);
            }
        }

        res.status(500).json({
            error: 'Failed to fetch crypto candles',
            message: error.message
        });
    }
});

// Get crypto-specific news
app.get('/api/crypto-news', async (req, res) => {
    try {
        const response = await axios.get('https://finnhub.io/api/v1/news', {
            params: {
                category: 'crypto',
                token: FINHUB_API_KEY
            },
            timeout: 10000,
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error fetching crypto news:', error.message);
        res.status(500).json({
            error: 'Failed to fetch crypto news',
            message: error.message
        });
    }
});

app.get('/api/news/:category', async (req, res) => {
    try {
        const { category } = req.params;
        const response = await axios.get('https://finnhub.io/api/v1/news', {
            params: {
                category: category,
                token: FINHUB_API_KEY
            },
            timeout: 10000,
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error fetching news:', error.message);
        res.status(500).json({
            error: 'Failed to fetch news',
            message: error.message
        });
    }
});

app.get('/api/company-news/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const today = new Date();
        const lastMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

        const response = await axios.get('https://finnhub.io/api/v1/company-news', {
            params: {
                symbol: symbol,
                from: lastMonth.toISOString().split('T')[0],
                to: today.toISOString().split('T')[0],
                token: FINHUB_API_KEY
            },
            timeout: 10000,
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error fetching company news:', error.message);
        res.status(500).json({
            error: 'Failed to fetch company news',
            message: error.message
        });
    }
});

// Alias for market news (frontend calls /api/market-news)
app.get('/api/market-news', async (req, res) => {
    try {
        const response = await axios.get('https://finnhub.io/api/v1/news', {
            params: {
                category: 'general',
                token: FINHUB_API_KEY
            },
            timeout: 10000,
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error fetching market news:', error.message);
        res.status(500).json({
            error: 'Failed to fetch market news',
            message: error.message
        });
    }
});

// Alias for stock-specific news (frontend calls /api/stock-news/:symbol)
app.get('/api/stock-news/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const today = new Date();
        const lastMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

        const response = await axios.get('https://finnhub.io/api/v1/company-news', {
            params: {
                symbol: symbol,
                from: lastMonth.toISOString().split('T')[0],
                to: today.toISOString().split('T')[0],
                token: FINHUB_API_KEY
            },
            timeout: 10000,
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error fetching stock news:', error.message);

        // Handle 403 forbidden errors
        if (error.response && error.response.status === 403) {
            return res.status(403).json({
                error: 'News not available',
                message: 'News for this stock exchange is not supported by the API.',
                symbol: req.params.symbol
            });
        }

        res.status(500).json({
            error: 'Failed to fetch stock news',
            message: error.message
        });
    }
});

app.get('/api/watchlist', (req, res) => {
    res.json([
        { symbol: 'AAPL', name: 'Apple Inc.' },
        { symbol: 'GOOGL', name: 'Alphabet Inc.' },
        { symbol: 'MSFT', name: 'Microsoft Corporation' },
        { symbol: 'TSLA', name: 'Tesla, Inc.' },
        { symbol: 'AMZN', name: 'Amazon.com, Inc.' }
    ]);
});

app.get('/api/indicators/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;

        const quoteResponse = await axios.get('https://finnhub.io/api/v1/quote', {
            params: {
                symbol: symbol,
                token: FINHUB_API_KEY
            },
            timeout: 10000,
        });

        const financialsResponse = await axios.get('https://finnhub.io/api/v1/stock/metric', {
            params: {
                symbol: symbol,
                metric: 'all',
                token: FINHUB_API_KEY
            },
            timeout: 10000,
        });

        const quote = quoteResponse.data;
        const financials = financialsResponse.data.metric || {};

        // Debug logging
        console.log(`Financials data for ${symbol}:`, Object.keys(financials));
        console.log('PE Ratio available:', financials['peBasicExclExtraTTM'] || financials['peNormalizedAnnual']);
        console.log('PB Ratio available:', financials['pbQuarterly'] || financials['priceToBook']);
        console.log('ROE available:', financials['roeTTM']);

        // Extract comprehensive financial metrics
        const indicators = {
            // Price & Valuation Metrics
            peRatio: financials['peBasicExclExtraTTM'] || financials['peNormalizedAnnual'] || null,
            pbRatio: financials['pbQuarterly'] || financials['priceToBook'] || null,
            psRatio: financials['psTTM'] || null,
            pcRatio: financials['priceToCashFlowTTM'] || null,
            evToEbitda: financials['enterpriseValueToEbitdaTTM'] || null,

            // Profitability Metrics
            roe: financials['roeTTM'] || null, // Return on Equity
            roa: financials['roaTTM'] || null, // Return on Assets
            roic: financials['roicTTM'] || null, // Return on Invested Capital
            grossMargin: financials['grossMarginTTM'] || null,
            operatingMargin: financials['operatingMarginTTM'] || null,
            netMargin: financials['netMarginTTM'] || null,

            // Financial Health Metrics
            debtToEquity: financials['totalDebtToEquityQuarterly'] || null,
            currentRatio: financials['currentRatioQuarterly'] || null,
            quickRatio: financials['quickRatioQuarterly'] || null,
            totalDebtToTotalCapital: financials['totalDebtToTotalCapitalQuarterly'] || null,

            // Growth Metrics
            revenueGrowth: financials['revenueGrowthTTM'] || null,
            earningsGrowth: financials['epsGrowthTTM'] || null,
            bookValuePerShare: financials['bookValuePerShareQuarterly'] || null,

            // Balance Sheet
            totalEquity: financials['totalShareholdersEquityQuarterly'] || null,
            totalAssets: financials['totalAssetsQuarterly'] || null,
            totalLiabilities: financials['totalLiabilitiesQuarterly'] || null,
            cashAndEquivalents: financials['cashAndShortTermInvestmentsQuarterly'] || null,

            // Income Statement
            eps: financials['epsBasicExclExtraItemsTTM'] || null,
            revenuePerShare: financials['revenuePerShareTTM'] || null,
            ebitda: financials['ebitdaTTM'] || null,

            // Market Data
            marketCap: financials['marketCapitalization'] || null,
            sharesOutstanding: financials['sharesOutstanding'] || null,
            beta: financials['beta'] || null,

            // Technical Indicators (calculated or from API)
            rsi: financials['rsi'] || null,
            macd: financials['macd'] || null,
            sma50: financials['52WeekHigh'] ? quote.c * 0.95 : null,
            sma200: financials['52WeekLow'] ? quote.c * 1.05 : null,
            volume: quote.v || 0,
            avgVolume: financials['10DayAverageTradingVolume'] || null,

            // 52-week data
            week52High: financials['52WeekHigh'] || null,
            week52Low: financials['52WeekLow'] || null,
            week52Change: financials['52WeekPriceReturnDaily'] || null
        };

        // Remove null values and format numbers
        const cleanedIndicators = {};
        Object.keys(indicators).forEach(key => {
            if (indicators[key] !== null && indicators[key] !== undefined) {
                if (typeof indicators[key] === 'number') {
                    // Format large numbers appropriately
                    if (key.includes('marketCap') || key.includes('total') || key.includes('ebitda')) {
                        cleanedIndicators[key] = indicators[key] >= 1e9 ? `${(indicators[key] / 1e9).toFixed(2)}B` :
                            indicators[key] >= 1e6 ? `${(indicators[key] / 1e6).toFixed(2)}M` :
                                indicators[key] >= 1e3 ? `${(indicators[key] / 1e3).toFixed(2)}K` :
                                    indicators[key].toFixed(2);
                    } else if (key.includes('Ratio') || key.includes('Margin') || key.includes('Growth') || key.includes('beta')) {
                        cleanedIndicators[key] = indicators[key].toFixed(2);
                    } else if (key.includes('PerShare') || key.includes('eps') || key.includes('sma') || key.includes('macd')) {
                        cleanedIndicators[key] = `$${indicators[key].toFixed(2)}`;
                    } else {
                        cleanedIndicators[key] = indicators[key].toFixed(2);
                    }
                } else {
                    cleanedIndicators[key] = indicators[key];
                }
            }
        });

        res.json({
            symbol: symbol,
            indicators: cleanedIndicators,
            lastUpdated: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching indicators:', error.message);

        // Handle 403 forbidden errors
        if (error.response && error.response.status === 403) {
            return res.status(403).json({
                error: 'Financial data not available',
                message: 'This stock exchange or symbol is not supported by the API. Try US stocks (e.g., AAPL) or Indian NSE stocks (e.g., RELIANCE.NS)',
                symbol: req.params.symbol
            });
        }

        res.status(500).json({
            error: 'Failed to fetch indicators',
            message: error.message
        });
    }
});

app.get('/api/prediction/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;

        const quoteResponse = await axios.get('https://finnhub.io/api/v1/quote', {
            params: {
                symbol: symbol,
                token: FINHUB_API_KEY
            },
            timeout: 10000,
        });

        const currentPrice = quoteResponse.data.c;

        if (!currentPrice || currentPrice === 0) {
            return res.status(404).json({ error: 'Stock data not available' });
        }

        const today = new Date();
        const lastMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

        const newsResponse = await axios.get('https://finnhub.io/api/v1/company-news', {
            params: {
                symbol: symbol,
                from: lastMonth.toISOString().split('T')[0],
                to: today.toISOString().split('T')[0],
                token: FINHUB_API_KEY
            },
            timeout: 10000,
        });

        const news = newsResponse.data || [];

        let sentimentScore = 0;
        const positiveWords = ['surge', 'gain', 'profit', 'growth', 'bullish', 'upgrade', 'beat', 'success', 'high', 'record', 'strong'];
        const negativeWords = ['fall', 'loss', 'decline', 'bearish', 'downgrade', 'miss', 'weak', 'low', 'drop', 'concern', 'risk'];

        news.forEach(item => {
            const headline = (item.headline || '').toLowerCase();
            positiveWords.forEach(word => {
                if (headline.includes(word)) sentimentScore += 1;
            });
            negativeWords.forEach(word => {
                if (headline.includes(word)) sentimentScore -= 1;
            });
        });

        const normalizedSentiment = Math.max(-1, Math.min(1, sentimentScore / Math.max(news.length, 10)));

        const prediction = generatePrediction(currentPrice, normalizedSentiment, news.length);

        res.json({
            symbol: symbol,
            currentPrice: currentPrice,
            prediction: prediction,
            sentiment: normalizedSentiment,
            newsCount: news.length,
            analysisDate: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error generating prediction:', error.message);

        // Handle 403 forbidden errors
        if (error.response && error.response.status === 403) {
            return res.status(403).json({
                error: 'Prediction not available',
                message: 'This stock exchange is not supported by the API. Predictions are available for US stocks and some international exchanges.',
                symbol: req.params.symbol
            });
        }

        res.status(500).json({
            error: 'Failed to generate prediction',
            message: error.message
        });
    }
});

function generatePrediction(currentPrice, sentiment, newsCount) {
    const sentimentFactor = sentiment * 0.08;
    const volumeBoost = Math.min(newsCount / 50, 0.01);
    let predictedChangePercent = sentimentFactor * 100;
    const randomFactor = (Math.random() - 0.7) * 0.02;
    predictedChangePercent += randomFactor * 100;
    predictedChangePercent += volumeBoost * 100;

    const predictions = [];
    const now = new Date();

    for (let i = 1; i <= 30; i++) {
        const futureDate = new Date(now);
        futureDate.setDate(now.getDate() + i);

        const dailyVariation = (Math.random() - 0.5) * 0.02;
        const compoundedChange = predictedChangePercent * (i / 30) + (dailyVariation * i * 100);
        const predictedPrice = currentPrice * (1 + compoundedChange / 100);

        predictions.push({
            date: futureDate.toISOString().split('T')[0],
            price: parseFloat(predictedPrice.toFixed(2)),
            changePercent: parseFloat(compoundedChange.toFixed(2)),
            confidence: Math.max(50, 90 - i * 1.3)
        });
    }

    return {
        predictions: predictions,
        summary: {
            trend: predictedChangePercent > 1 ? 'bullish' : predictedChangePercent < -1 ? 'bearish' : 'neutral',
            expectedChange: parseFloat(predictedChangePercent.toFixed(2)),
            targetPrice: parseFloat((currentPrice * (1 + predictedChangePercent / 100)).toFixed(2)),
            confidence: 75
        }
    };
}

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});
