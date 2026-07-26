// 给你一个字符串数组，请你将 字母异位词 组合在一起。可以按任意顺序返回结果列表。

 

// 示例 1:

// 输入: strs = ["eat", "tea", "tan", "ate", "nat", "bat"]

// 输出: [["bat"],["nat","tan"],["ate","eat","tea"]]

// 解释：

// 在 strs 中没有字符串可以通过重新排列来形成 "bat"。
// 字符串 "nat" 和 "tan" 是字母异位词，因为它们可以重新排列以形成彼此。
// 字符串 "ate" ，"eat" 和 "tea" 是字母异位词，因为它们可以重新排列以形成彼此。
// 示例 2:

// 输入: strs = [""]

// 输出: [[""]]

// 示例 3:

// 输入: strs = ["a"]

// 输出: [["a"]]
function groupAnagrams(strs: string[]): string[][] {
    const map = new Map<string, string[]>();
    for (const str of strs) {
        const sortedStr = str.split('').sort().join('');
        if (map.has(sortedStr)) {
            map.get(sortedStr)?.push(str);
        } else {
            map.set(sortedStr, [str]);
        }
    }
    return Array.from(map.values());
};


function groupAnagrams(strs: string[]): string[][] {
   const map = {}
   for (const str of strs) {
     const charsArr = new Array(26).fill(0);
     for (const char of str) {
        charsArr[char.charCodeAt(0) - 'a'.charCodeAt(0)]++;
     }
     const key = charsArr.join('-');
     if (map[key]) {
        map[key].push(str);
     } else {
        map[key] = [str];
     }  
   }
   return Object.values(map);
};