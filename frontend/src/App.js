import logo from './logo.svg';
import './App.css';
import React, { useState, useEffect, useRef } from 'react'; // Add useEffect import
import axios from 'axios';

// 在文件顶部添加常量
const API_BASE_URL = `${window.location.protocol}//${window.location.hostname}:5050`; // 保持端口 5050

function App() {
  const [rssList, setRssList] = useState([]);
  const [newRssUrl, setNewRssUrl] = useState('');
  const [selectedRss, setSelectedRss] = useState('');
  const [feed, setFeed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deletedItems, setDeletedItems] = useState([]); // 新增：存储最近删除的项

  const [showActionMenu, setShowActionMenu] = useState(null); // 新增状态，用于控制操作菜单显示

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchRssList();
    }, 500); // 添加500ms延迟

    return () => clearTimeout(timer); // 清理定时器
  }, []);

  const addRss = async () => {
    if (!newRssUrl) return;

    // 验证URL格式
    try {
      new URL(newRssUrl);
    } catch (error) {
      alert('请输入有效的URL');
      return;
    }

    setLoading(true);
    try {
      // 先验证RSS源是否有效
      const validationResponse = await axios.get(`${API_BASE_URL}/rss?url=${encodeURIComponent(newRssUrl)}`);
      if (validationResponse.status !== 200) {
        throw new Error('无效的RSS源');
      }

      // 如果验证通过，再添加RSS源
      const addResponse = await axios.post(`${API_BASE_URL}/rss/add`, JSON.stringify(newRssUrl), {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 5000,
        withCredentials: true
      });

      if (addResponse.status === 201) {
        // 强制刷新RSS列表
        await fetchRssList();
        // 自动切换到新添加的RSS源
        setSelectedRss(newRssUrl);
        await handleRssClick(newRssUrl); // 确保右侧页面自动打开
        setNewRssUrl('');
        setShowAddPanel(false); // 添加成功后关闭弹出框
      }
    } catch (error) {
      console.error('添加RSS源失败:', error);
      alert('无法添加RSS源，请检查链接是否有效');
    } finally {
      setLoading(false);
    }
  };

  const [rssTitles, setRssTitles] = useState({});

  // 新增加载状态
  const [isLoading, setIsLoading] = useState(false);

  // 修改 fetchRssList 方法
  const fetchRssList = async () => {
    setIsLoading(true); // 显示加载中
    try {
      const response = await axios.get(`${API_BASE_URL}/rss/list?t=${Date.now()}`, {
        withCredentials: true
      });
      setRssList(response.data);

      // 获取每个 RSS 源的标题
      const titles = {};
      await Promise.all(response.data.map(async (url) => {
        try {
          const feedResponse = await axios.get(`${API_BASE_URL}/rss?url=${encodeURIComponent(url)}`);
          titles[url] = feedResponse.data.title;
        } catch (error) {
          console.error('获取 RSS 标题失败:', error);
          titles[url] = '加载中...'; // 如果获取失败，显示“加载中”
        }
      }));
      setRssTitles(titles);

      // 如果当前没有选中任何 RSS 源，自动切换到第一个
      if (!selectedRss && response.data.length > 0) {
        setSelectedRss(response.data[0]);
        await handleRssClick(response.data[0]);
      }
    } catch (error) {
      console.error('获取RSS列表失败:', error);
    } finally {
      setIsLoading(false); // 隐藏加载中
    }
  };

  const removeRss = async (url) => {
    try {
      await axios.delete(`${API_BASE_URL}/rss/remove?url=${encodeURIComponent(url)}`);

      // 将删除的项添加到 deletedItems 数组
      setDeletedItems(prev => [url, ...prev]);

      // 如果删除的是当前显示的 RSS 源
      if (selectedRss === url) {
        setSelectedRss('');
        setFeed(null);

        // 如果还有其他 RSS 源，则显示第一个
        const newList = rssList.filter(item => item !== url);
        if (newList.length > 0) {
          await handleRssClick(newList[0]);
        }
      }

      // 更新 RSS 列表
      setRssList(prev => prev.filter(item => item !== url));
    } catch (error) {
      console.error('删除失败:', error);
      alert('删除 RSS 源失败');
    }
  };

  // 新增：撤销删除功能
  const undoDelete = async () => {
    if (deletedItems.length === 0) return;

    const urlToRestore = deletedItems[0];
    try {
      await axios.post(`${API_BASE_URL}/rss/add`, JSON.stringify(urlToRestore), {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      setRssList(prev => [...prev, urlToRestore]);
      setDeletedItems(prev => prev.slice(1));
      await handleRssClick(urlToRestore); // 自动切换到恢复的 RSS 源
    } catch (error) {
      console.error('恢复失败:', error);
      alert('恢复 RSS 源失败');
    }
  };

  // 新增：监听键盘事件
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undoDelete();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [deletedItems]);

  const fetchFeed = async (url) => {
    setSelectedRss(url);
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/rss?url=${encodeURIComponent(url)}`);
      const feedData = response.data;

      // 处理图片信息
      const itemsWithImages = await Promise.all(feedData.items.map(async (item) => {
        let image = null;

        // 优先从文章链接中提取图片
        if (item.link) {
          try {
            const htmlResponse = await axios.get(`${API_BASE_URL}/proxy?url=${encodeURIComponent(item.link)}`);
            image = extractFirstImageFromHtml(htmlResponse.data);
          } catch (error) {
            console.error('获取文章内容失败:', error);
          }
        }

        // 如果从文章链接中无法获取图片，再尝试从 RSS 源中获取
        if (!image) {
          image =
            item['media:content']?.url ||
            item['media:thumbnail']?.url ||
            item.enclosure?.url ||
            extractFirstImageFromHtml(item['content:encoded'] || item.description);
        }

        // 确保图片 URL 是完整的
        if (image && !image.startsWith('http')) {
          try {
            const baseUrl = new URL(item.link).origin;
            image = new URL(image, baseUrl).toString();
          } catch (error) {
            console.error('处理图片 URL 失败:', error);
            image = null;
          }
        }

        return {
          ...item,
          image: image || 'https://via.placeholder.com/120/80' // 如果仍然没有图片，使用默认图片
        };
      }));

      setFeed({
        ...feedData,
        items: itemsWithImages
      });
    } catch (error) {
      alert('无法获取RSS源');
    } finally {
      setLoading(false);
    }
  };

  // 辅助函数：从 HTML 内容中提取第一个图片链接
  const extractFirstImageFromHtml = (html) => {
    if (!html) return null;
    const imgRegex = /<img[^>]+src="([^">]+)"/;
    const match = html.match(imgRegex);
    if (!match) return null;

    // 处理相对路径
    let imageUrl = match[1];
    if (imageUrl.startsWith('//')) {
      imageUrl = `https:${imageUrl}`;
    } else if (imageUrl.startsWith('/')) {
      imageUrl = `https://${new URL(item.link).host}${imageUrl}`;
    }
    return imageUrl;
  };

  const handleRssClick = async (url) => {
    setSelectedRss(url);
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/rss?url=${encodeURIComponent(url)}`);
      setFeed(response.data);
    } catch (error) {
      alert('无法获取RSS源');
    } finally {
      setLoading(false);
    }
  };

  const [showAddPanel, setShowAddPanel] = useState(false);
  const addPanelRef = useRef(null);
  const inputRef = useRef(null);

  // TODO: 实现 ESC 键和右上角关闭按钮关闭弹出框的功能
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (addPanelRef.current && !addPanelRef.current.contains(event.target)) {
        setShowAddPanel(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // 新增 useEffect 处理输入框聚焦
  useEffect(() => {
    if (showAddPanel && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showAddPanel]);

  const [previewItem, setPreviewItem] = useState(null);
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);

  // TODO: 实现右侧预览功能，当鼠标划过文章项时显示预览框
  const handleMouseEnter = async (item) => {
    console.log('Mouse Enter:', item); // 调试信息
    setPreviewItem(item);
    setIsPreviewVisible(true);
  };

  const handleMouseLeave = () => {
    console.log('Mouse Leave'); // 调试信息
    setIsPreviewVisible(false);
  };

  return (
    <div className="app-container">
      {/* 添加加载指示器 */}
      {isLoading && (
        <div className="loading-indicator">
          <div className="loading-spinner"></div>
          加载中...
        </div>
      )}

      <div className="sidebar">
        <div className="sidebar-header">
          <h2>我的RSS源</h2>
          <button className="add-button" onClick={() => setShowAddPanel(!showAddPanel)}>
            {showAddPanel ? '×' : '+'}
          </button>
        </div>

        {showAddPanel && (
          <div className="add-panel">
            <div className="add-rss">
              <input
                type="text"
                value={newRssUrl}
                onChange={(e) => setNewRssUrl(e.target.value)}
                placeholder="RSS 源 URL"
                className="search-input"
              />
              <button onClick={addRss} className="search-button" disabled={loading}>
                {loading ? '添加中...' : '添加'}
              </button>
            </div>
          </div>
        )}
        <div className="rss-list">
          {rssList.map((url) => (
            <div key={url} className={`rss-item ${selectedRss === url ? 'active' : ''}`}>
              <span onClick={() => handleRssClick(url)} className="rss-url">
                {rssTitles[url] || '加载中...'} {/* 如果标题不存在，显示“加载中” */}
              </span>
              <div className="rss-actions">
                <button
                  className="action-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeRss(url);
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={`main-content ${showAddPanel ? 'blurred' : ''}`}>
        {feed && (
          <main className="feed-container">
            <h2 className="feed-title">{feed.title}</h2>
            <div className="feed-list">
              {feed.items.map((item) => (
                <div className="feed-item"
                  key={item.link}
                  onMouseEnter={() => handleMouseEnter(item)}
                  onMouseLeave={handleMouseLeave}
                  onClick={() => window.open(item.link, '_blank')}>
                  <div className="image-container">
                    <img
                      src={item.custom?.image || item.image || `https://picsum.photos/seed/${encodeURIComponent(feed.title)}/120/80`}
                      alt={item.title}
                      className="feed-item-image"
                      loading="lazy"
                      onError={(e) => {
                        e.target.src = `https://picsum.photos/seed/${encodeURIComponent(feed.title)}/120/80`;
                        console.warn('图片加载失败，使用默认图片:', item.image);
                      }}
                    />
                    {/* TODO: 图片加载中状态未显示，需要检查样式和逻辑 */}
                    {!item.custom?.image && !item.image && (
                      <div className="image-loading">
                        <div className="loading-spinner"></div>
                        加载中...
                      </div>
                    )}
                  </div>
                  <div className="feed-item-content">
                    <div className="feed-item-source">{feed.title}</div>
                    <h3 className="feed-item-title">{item.title}</h3>
                    {/* 动态显示发布时间 */}
                    {item.published && (
                      <div className="feed-item-time">
                        {console.log('published:', item.published)} {/* 打印 published */}
                        {new Date(item.published).toLocaleDateString('zh-CN', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </main>
        )}
      </div>
      {showAddPanel && (
        <div className="add-panel" ref={addPanelRef}>
          <div className="add-rss">
            <input
              ref={inputRef}
              type="text"
              value={newRssUrl}
              onChange={(e) => setNewRssUrl(e.target.value)}
              placeholder="RSS 链接"
              className="search-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loading) {
                  addRss();
                }
              }}
            />
            <button onClick={addRss} className="search-button" disabled={loading}>
              {loading ? '添加中...' : '添加'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
